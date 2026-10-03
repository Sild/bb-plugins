import { workflowParent } from "./workflow-parent";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { gitContract, mergeTargetSchema } from "./git-contract";
import { taskWorktreeProvider } from "./task-worktree-provider";
import { isWorking } from "./board";

const jobSchema = z.object({ threadId: z.string(), environmentId: z.string(), hostId: z.string(), target: mergeTargetSchema, acceptedRevision: z.number().optional(),
  phase: z.enum(["merging", "prompting", "resolving", "cleanup", "blocked"]), error: z.string().nullable() });
type Job = z.infer<typeof jobSchema>;
const key = (id: string) => `merge/${id}`;

export function mergeWorkflow(bb: BbPluginApi, changed: (threadId: string) => void, latestRequest: (id: string) => Promise<string | null>) {
  const host = bb.hosts.experimental_client({ contract: gitContract });
  const running = new Set<string>();
  const starting = new Set<string>();
  async function jobFor(id: string) {
    const raw = await bb.storage.kv.get(key(id));
    return raw === undefined ? null : jobSchema.parse(raw);
  }
  async function save(job: Job) {
    await bb.storage.kv.set(key(job.threadId), job);
    await bb.sdk.threads.updatePluginMetadata({ threadId: job.threadId, set: { merging: true, mergeError: job.error, acceptedFor: null } });
    changed(job.threadId);
  }
  async function sharedState(id: string, environmentId: string) {
    const threads: Awaited<ReturnType<typeof bb.sdk.threads.list>> = [];
    for (let offset = 0; ; offset += 500) {
      const page = await bb.sdk.threads.list({ archived: false, includeHidden: true, environmentId, limit: 500, offset });
      threads.push(...page);
      if (page.length < 500) break;
    }
    const parents = new Map(await Promise.all(threads.map(async row => [row.id, await workflowParent(bb, row)] as const)));
    function rootOf(threadId: string) {
      const visited = new Set<string>();
      let parent = parents.get(threadId);
      while (parent && !visited.has(threadId)) {
        visited.add(threadId);
        threadId = parent;
        parent = parents.get(threadId);
      }
      return threadId;
    }
    const root = rootOf(id);
    let shared = false;
    let working = false;
    let related = true;
    for (const row of threads) {
      if (row.id === id) continue;
      shared = true;
      if (rootOf(row.id) !== root) related = false;
      if (isWorking(row.runtime.displayStatus) || row.hasPendingInteraction || (row.activity?.activeBackgroundAgentCount ?? 0) > 0) working = true;
    }
    return { shared, working, related };
  }
  async function finish(id: string) {
    const thread = await bb.sdk.threads.get({ threadId: id });
    if (isWorking(thread.runtime.displayStatus) || thread.activeBackgroundAgentCount > 0) return;
    const job = await jobFor(id);
    await bb.sdk.threads.updatePluginMetadata({ threadId: id, set: { merging: false, mergeError: null, acceptedFor: job?.acceptedRevision ?? thread.updatedAt, acceptedAt: Date.now(), outcome: "done", outcomeRequestId: await latestRequest(id) } });
    await bb.storage.kv.delete(key(id)); changed(id);
    await bb.experimental_hooks.recheck("message.dispatch");
  }
  async function checkout(projectId: string, hostId: string) {
    const project = await bb.sdk.projects.get({ projectId });
    const sources = project.sources.filter(source => source.hostId === hostId && source.type === "local_path");
    const source = sources.find(source => source.isDefault) ?? (sources.length === 1 ? sources[0] : null);
    if (!source?.path) throw new Error("No unambiguous project checkout on this machine.");
    return source.path;
  }
  async function checkDone(id: string) {
    const thread = await bb.sdk.threads.get({ threadId: id });
    if (!thread.environmentId) return;
    const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
    if (!environment.isGitRepo || !environment.path || environment.status === "destroyed") return;
    const state = await host.call("inspect", { path: environment.path }, { hostId: environment.hostId });
    if (state.operation) throw new Error("Finish Git operations before reporting Done.");
  }
  async function prompt(job: Job) {
    await bb.sdk.threads.send({ threadId: job.threadId, mode: "queue-if-active", input: [{ type: "text", mentions: [], text:
      `The user clicked Accept, authorizing local merge and cleanup. Automatic merge needs your help: ${job.error}\n` +
      `Task worktree: ${JSON.stringify(job.target.worktree)} on branch ${JSON.stringify(job.target.taskBranch)}. Destination checkout: ${JSON.stringify(job.target.checkout)} on captured branch ${JSON.stringify(job.target.branch)}.\n` +
      "Resolve conflicts by merging the destination branch into the task branch in the task worktree, preserving both sets of intended changes. Validate and commit the resolution, then run bb kanban report done. The plugin will retry landing and cleanup after your turn is idle. Do not remove the worktree, switch destination branches, discard or stash unrelated changes, push, or accept the task yourself. If a dirty destination or changed branch needs user action, ask for it and report waiting. This task stays Active with Merging... until landing and cleanup finish."
    }] });
    job.phase = "resolving";
    await save(job);
  }
  async function process(id: string, signal?: AbortSignal) {
    if (running.has(id)) return;
    running.add(id);
    try {
      const job = await jobFor(id);
      if (!job || job.phase === "blocked" || job.phase === "resolving") return;
      const thread = await bb.sdk.threads.get({ threadId: id });
      if (isWorking(thread.runtime.displayStatus) || thread.activeBackgroundAgentCount > 0) return;
      if (job.phase === "prompting") { await prompt(job); return; }
      if (job.phase === "merging") {
        const peers = await sharedState(id, job.environmentId);
        if (peers.shared && !job.target.taskHead) throw new Error("Shared landing has no captured task commit; verify it manually before retrying.");
        if (!peers.related) throw new Error("The worktree is shared with an unrelated thread; landing stopped to avoid merging its commits.");
        if (peers.working) return;
      }
      if (job.phase === "merging") {
        const result = await host.call("merge", job.target, { hostId: job.hostId, signal, timeoutMs: 180_000 });
        if (result.status === "blocked" && result.message === "Another task is merging into this checkout. Retry after it finishes.") return;
        if (result.status !== "merged") {
          job.phase = "prompting"; job.error = result.message;
          await save(job); await prompt(job); return;
        }
        job.phase = "cleanup"; job.error = null; await save(job);
      }
      const environment = await bb.sdk.environments.get({ environmentId: job.environmentId });
      if (environment.status !== "destroyed") {
        await checkDone(id);
        if (!await host.call("verify", job.target, { hostId: job.hostId, signal })) throw new Error("The merge could not be verified. Worktree retained.");
        const beforeDelete = await bb.sdk.threads.get({ threadId: id });
        if (isWorking(beforeDelete.runtime.displayStatus) || beforeDelete.activeBackgroundAgentCount > 0) return;
        // Core refuses deletion while any unarchived thread is attached, including
        // this idle task. Accept completes landing; archive owns retirement.
        if (beforeDelete.archivedAt === null || (await sharedState(id, job.environmentId)).shared) { await finish(id); return; }
        const branchTarget = { checkout: job.target.checkout, worktree: job.target.worktree, branch: job.target.branch, taskBranch: job.target.taskBranch };
        if (!await host.call("verify", branchTarget, { hostId: job.hostId, signal })) throw new Error("The task branch has commits outside the accepted snapshot. Worktree retained.");
        // Only archived, exclusive task environments can be removed here.
        await bb.sdk.environments.delete({ environmentId: job.environmentId });
        const current = await bb.sdk.environments.get({ environmentId: job.environmentId });
        if (current.status !== "destroyed") { changed(id); return; }
      }
      await host.call("cleanupBranch", job.target, { hostId: job.hostId, signal });
      await finish(id);
    } catch (cause) {
      if (signal?.aborted) return;
      const job = await jobFor(id);
      if (job) { job.phase = "blocked"; job.error = cause instanceof Error ? cause.message : String(cause); await save(job); }
      bb.log.warn(`Merge stopped for ${id}: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally { running.delete(id); }
  }
  async function begin(id: string) {
    if (starting.has(id)) throw new Error("This task is already merging.");
    starting.add(id);
    try {
      if (await jobFor(id)) throw new Error("This task is already merging.");
      const thread = await bb.sdk.threads.get({ threadId: id });
      if (!thread.environmentId) return false;
      const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
      if (!environment.isWorktree) return false;
      if (!["git-worktree", taskWorktreeProvider].includes(environment.environmentProviderId ?? "") || !environment.managed || !environment.path) throw new Error("Accept cleanup requires a managed Git worktree.");
      const target = await host.call("target", { checkout: await checkout(thread.projectId, environment.hostId), worktree: environment.path }, { hostId: environment.hostId });
      await save({ threadId: id, environmentId: environment.id, hostId: environment.hostId, target, acceptedRevision: thread.updatedAt, phase: "merging", error: null });
      await process(id);
      return true;
    } finally { starting.delete(id); }
  }
  async function retry(id: string) {
    const job = await jobFor(id);
    if (!job) throw new Error("No merge to retry.");
    const environment = await bb.sdk.environments.get({ environmentId: job.environmentId });
    job.phase = environment.status === "destroyed" || environment.lifecycle.phase === "teardown" ? "cleanup" : "merging";
    job.error = null; await save(job); await process(id);
  }
  async function reportDone(id: string) {
    const job = await jobFor(id);
    if (job?.phase === "resolving" || job?.phase === "blocked") {
      if (job.phase === "resolving") {
        try {
          const target = await host.call("target", { checkout: job.target.checkout, worktree: job.target.worktree }, { hostId: job.hostId });
          if (target.branch !== job.target.branch || target.taskBranch !== job.target.taskBranch) throw new Error("A checkout changed branches during conflict resolution.");
          job.target = target;
          job.acceptedRevision = (await bb.sdk.threads.get({ threadId: id })).updatedAt;
        } catch (cause) {
          job.phase = "blocked";
          job.error = cause instanceof Error ? cause.message : String(cause);
          await save(job);
          return;
        }
      }
      const environment = await bb.sdk.environments.get({ environmentId: job.environmentId });
      job.phase = environment.status === "destroyed" || environment.lifecycle.phase === "teardown" ? "cleanup" : "merging";
      job.error = null; await save(job);
    }
  }
  async function reconcile(signal?: AbortSignal) {
    for (const entry of await bb.storage.kv.list("merge/")) {
      if (signal?.aborted) break;
      const id = entry.slice(6);
      const job = await jobFor(id);
      // Recover previously authorized landings blocked by the old delete call.
      // Resume verification only: do not merge newer task commits on recovery.
      if (job?.phase === "blocked" && job.error === "HTTP 409: Environment still has live threads") {
        job.phase = "cleanup"; job.error = null; await save(job);
      }
      await process(id, signal);
    }
  }
  bb.background.service("recover-merges", { start: signal => reconcile(signal) });
  bb.background.schedule("continue-merges", "* * * * *", () => reconcile());
  bb.events.on("thread.idle", ({ thread }) => process(thread.id));
  bb.experimental_hooks.on("message.dispatch", async context => {
    const newDraft = context.experimental_submission?.pluginId === bb.pluginId
      && context.experimental_submission.data !== null
      && typeof context.experimental_submission.data === "object"
      && !Array.isArray(context.experimental_submission.data)
      && context.experimental_submission.data.kind === "draft";
    const savedDraft = context.queuedMessages.some((entry) =>
      entry.waitingOn?.kind === "plugin" && entry.waitingOn.pluginId === bb.pluginId && entry.waitingOn.reason === "Draft");
    if (newDraft || savedDraft) return { action: "wait", reason: "Draft" };
    const job = await jobFor(context.thread.id);
    if (job && (job.phase === "merging" || job.phase === "cleanup")) return { action: "wait", reason: "Merging... Waiting for local landing and worktree cleanup." };
    return { action: "proceed" };
  });
  return { begin, checkDone, retry, reportDone, host };
}
