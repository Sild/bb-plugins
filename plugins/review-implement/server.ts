import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { workflow } from "./workflow-config";

const threadId = z.string().min(1);
export const rpcContract = defineRpcContract({
  startPlan: { input: z.object({ threadId, kind: z.enum(["plan", "design"]), instruction: z.string().optional() }), output: z.object({ childThreadId: threadId }) },
  startImplementation: { input: z.object({ threadId, instruction: z.string().optional() }), output: z.object({ childThreadId: threadId }) },
});

type ArtifactKind = "plan" | "design" | "implementation";
type Job = {
  kind: ArtifactKind | "review";
  sourceThreadId: string;
  artifactThreadId?: string;
  reviewRound: number;
  provider: "claude-code" | "codex";
  phase: "working" | "delivering" | "delivered" | "done" | "failed";
  verdict?: "approved" | "changes_requested";
  artifactRequestId?: string | null;
  legacyManual?: boolean;
  legacyReview?: boolean;
};
type LegacyJob = {
  kind: "review" | "implementation" | "implementation-review" | "implementation-fixes";
  sourceThreadId: string;
  implementationThreadId?: string;
  phase: Job["phase"];
};
const jobKey = (id: string) => `job:${id}`;
const JOB_IDS = "job-ids";
const message = (text: string) => [{ type: "text" as const, text, mentions: [] }];
const boardCard = z.object({ id: threadId, column: z.string() }).passthrough();

export default async function plugin(bb: BbPluginApi) {
  const running = new Set<string>();
  let registration = Promise.resolve();
  const linked = new Set<string>();
  async function link(id: string, job: Job) {
    if (linked.has(id) || job.legacyManual || job.phase === "failed") return;
    const thread = await bb.sdk.threads.get({ threadId: id });
    const parentId = job.artifactThreadId ?? job.sourceThreadId;
    const metadata = await bb.sdk.threads.getPluginMetadata({ threadId: id });
    if (metadata.workflowParentThreadId !== parentId) await bb.sdk.threads.updatePluginMetadata({ threadId: id, set: { workflowParentThreadId: parentId } });
    if (thread.parentThreadId !== null) await bb.sdk.threads.update({ threadId: id, parentThreadId: null });
    linked.add(id);
  }

  async function source(id: string) {
    const thread = await bb.sdk.threads.get({ threadId: id });
    if (!thread.environmentId) throw new Error("This thread has no reusable environment.");
    if (thread.archivedAt || thread.deletedAt) throw new Error("This thread is archived or deleted.");
    return thread;
  }
  async function saveJob(id: string, job: Job) {
    await bb.storage.kv.set(jobKey(id), job);
    await link(id, job);
    registration = registration.catch(() => {}).then(async () => {
      const ids = (await bb.storage.kv.get<string[]>(JOB_IDS)) ?? [];
      if (!ids.includes(id)) await bb.storage.kv.set(JOB_IDS, [...ids, id]);
    });
    await registration;
  }
  async function readJob(id: string): Promise<Job | undefined> {
    const saved = await bb.storage.kv.get<Job | LegacyJob>(jobKey(id));
    if (!saved) return;
    if ("reviewRound" in saved) {
      await link(id, saved);
      return saved;
    }
    if (saved.phase === "failed") return;
    // Preserve pending pre-upgrade handoffs. Old producer fix turns enter the new
    // review flow, while old reviews deliver their feedback before being accepted.
    const child = await bb.sdk.threads.get({ threadId: id });
    const review = saved.kind === "review" || saved.kind === "implementation-review";
    const migrated: Job = {
      kind: review ? "review" : "implementation", sourceThreadId: saved.sourceThreadId,
      phase: saved.phase, reviewRound: 1, provider: child.providerId === "claude-code" ? "claude-code" : "codex",
      ...(saved.kind === "review" ? { legacyManual: true } : {}),
      ...(saved.kind === "implementation-review" ? { artifactThreadId: saved.implementationThreadId, legacyReview: true } : {}),
    };
    await saveJob(id, migrated); return migrated;
  }
  async function column(id: string) {
    return (await bb.sdk.plugins.callRpc({ pluginId: "kanban", method: "board_thread", input: { threadId: id }, outputSchema: boardCard })).column;
  }
  async function accept(id: string, parentId: string, plan = false, reviewThreadId?: string) {
    await bb.sdk.plugins.callRpc({ pluginId: "kanban", method: plan ? "board_accept_plan" : "board_accept_review", input: { threadId: id, parentThreadId: parentId, ...(reviewThreadId ? { reviewThreadId } : {}) }, outputSchema: boardCard });
  }
  async function reviewer(parentId: string): Promise<Job["provider"]> {
    const parent = await source(parentId);
    const environment = await bb.sdk.environments.get({ environmentId: parent.environmentId! });
    try {
      const usage = (await bb.sdk.system.usageLimits({ hostId: environment.hostId, providerId: "claude-code" }))["claude-code"];
      return usage?.status === "ok" && usage.windows.length > 0 && usage.windows.every(window => window.usedPercent < 100) ? "claude-code" : "codex";
    } catch (error) {
      bb.log.warn(`Claude quota unavailable; using Codex review: ${String(error)}`);
      return "codex";
    }
  }
  async function history(id: string) {
    // Cross-provider planning cannot clone a provider session. Include every timeline
    // page instead of substituting a summary; nested rows preserve tool/artifact context.
    const pages: unknown[] = [];
    let cursor: { anchorId: string; anchorSeq: number } | null = null;
    const cursors = new Set<string>();
    do {
      const page = await bb.sdk.threads.timeline({ threadId: id, includeNestedRows: "true", summaryOnly: "false", segmentLimit: "100", ...(cursor ? { beforeAnchorId: cursor.anchorId, beforeAnchorSeq: String(cursor.anchorSeq) } : {}) });
      pages.unshift(page.rows);
      cursor = page.timelinePage.hasOlderRows ? page.timelinePage.olderCursor : null;
      if (page.timelinePage.hasOlderRows && !cursor) throw new Error("Could not read the complete source context.");
      if (cursor) {
        const key = `${cursor.anchorId}:${cursor.anchorSeq}`;
        if (cursors.has(key)) throw new Error("Source context pagination did not advance.");
        cursors.add(key);
      }
    } while (cursor);
    return `Full source conversation timeline (oldest first, including nested tool rows):\n${JSON.stringify(pages)}\n\n`;
  }
  async function spawnJob(parentId: string, job: Job, prompt: string, fullContext = false) {
    const parent = await source(parentId);
    const root = await source(job.sourceThreadId);
    const titleSource = job.kind === "review" ? parent : root;
    const sourceTitle = titleSource.title ?? titleSource.titleFallback ?? titleSource.id;
    // Chained actions replace workflow markers while preserving ordinary title tags.
    const title = job.kind === "review" ? sourceTitle : sourceTitle.replace(/^(?:\[(?:👁|PLAN|DESIGN|<\/>)\]\s*)+/, "") || sourceTitle;
    const prefix = job.kind === "review" ? "[👁]" : job.kind === "implementation" ? "[</>]" : `[${job.kind.toUpperCase()}]`;
    const separator = job.kind === "review" && /^\[(?:PLAN|DESIGN|<\/>)\] /.test(title) ? "" : " ";
    const planning = job.kind === "plan" || job.kind === "design";
    const nativeFork = fullContext && planning && parent.providerId === "codex";
    const context = fullContext && !nativeFork ? await history(parentId) : "";
    const child = await bb.sdk.threads.spawn({
      projectId: parent.projectId,
      environment: { type: "reuse", environmentId: parent.environmentId! },
      ...(nativeFork ? { originKind: "fork" as const, sourceThreadId: parentId } : {}),
      title: `${prefix}${separator}${title}`,
      providerId: job.provider,
      ...(job.provider === "codex" ? { model: planning ? workflow.planningModel : job.kind === "review" ? workflow.reviewModel : workflow.implementationModel } : {}),
      reasoningLevel: planning ? workflow.planningReasoning : job.kind === "review" ? workflow.reviewReasoning : workflow.implementationReasoning,
      prompt: context + prompt,
      permissionMode: job.kind === "implementation" || job.kind === "review" ? "auto" : "accept-edits",
      pluginMetadata: { kind: job.kind, sourceThreadId: job.sourceThreadId, workflowParentThreadId: parentId, ...(job.artifactThreadId ? { artifactThreadId: job.artifactThreadId } : {}) },
    });
    await saveJob(child.id, job);
    return child.id;
  }
  async function artifactRequestId(id: string) {
    const events = await bb.sdk.threads.events.list({ threadId: id, types: ["client/turn/requested", "turn/started"], order: "desc", limit: "1" });
    return events[0]?.id ?? null;
  }
  async function startReview(artifactId: string, artifactJob: Job, provider?: Job["provider"]) {
    const requestId = await artifactRequestId(artifactId);
    const { output: artifact } = await bb.sdk.threads.output({ threadId: artifactId });
    return spawnJob(artifactId, { kind: "review", sourceThreadId: artifactJob.sourceThreadId, artifactThreadId: artifactId, artifactRequestId: requestId, reviewRound: artifactJob.reviewRound, provider: provider ?? await reviewer(artifactId), phase: "working" },
      `${workflow.instructions.review}\n\nOriginal requirements: @thread:${artifactJob.sourceThreadId}. Artifact to review: @thread:${artifactId}. Use bb thread show and bb thread log to verify the latest requirements and referenced evidence. This is review round ${artifactJob.reviewRound}.\n\nComplete artifact:\n${artifact ?? "No final artifact available; read the artifact thread."}`);
  }
  async function failure(job: Job, childId: string, report: string) {
    await bb.sdk.threads.send({ threadId: job.sourceThreadId, mode: "auto", input: message(`Workflow thread @thread:${childId} could not complete its reviewed artifact. Investigate this blocker before treating the work as complete.\n\n${report}`) });
    await saveJob(childId, { ...job, phase: "failed" });
  }
  async function deliver(childId: string, output: string | null, failed: boolean) {
    if (running.has(childId)) return;
    running.add(childId);
    try {
      const job = await readJob(childId);
      if (!job || (job.phase !== "working" && job.phase !== "delivered")) return;
      const child = await bb.sdk.threads.get({ threadId: childId });
      if (child.status !== "idle" && child.status !== "error") return;
      if (failed || child.status === "error") {
        // A quota race may exhaust Claude after the preflight. Replace only that
        // failed review, retaining the artifact and round; other failures stay visible.
        if (job.kind === "review" && job.provider === "claude-code" && job.artifactThreadId && await reviewer(job.artifactThreadId) === "codex") {
          const artifactJob = await readJob(job.artifactThreadId);
          if (!artifactJob) throw new Error("Review has no artifact job.");
          await saveJob(childId, { ...job, phase: "delivering" });
          await startReview(job.artifactThreadId, artifactJob, "codex");
          await saveJob(childId, { ...job, phase: "failed" });
          return;
        }
        await failure(job, childId, output ?? "Agent failed without a final artifact."); return;
      }
      if (job.legacyManual) {
        if (job.phase === "working") {
          if (await column(childId) !== "done") return;
          await saveJob(childId, { ...job, phase: "delivering" });
          await bb.sdk.threads.send({ threadId: job.sourceThreadId, mode: "auto", input: message(`Pre-upgrade review @thread:${childId} completed. Read its findings and verify any warranted changes:\n\n${output ?? "No final report."}`) });
          await saveJob(childId, { ...job, phase: "delivered" });
        }
        await accept(childId, child.parentThreadId ?? job.sourceThreadId);
        await saveJob(childId, { ...job, phase: "done" }); return;
      }
      if (job.phase === "delivered") {
        await finishAcceptance(childId, job);
        return;
      }
      // Questions, interrupted turns and missing Done reports never advance a workflow.
      if (await column(childId) !== "done") return;
      if (!output?.trim()) { await failure(job, childId, "The agent reported Done without a final artifact."); return; }
      if (job.kind !== "review") {
        await saveJob(childId, { ...job, phase: "delivering" });
        await startReview(childId, job);
        await saveJob(childId, { ...job, phase: "done" });
        return;
      }
      if (!job.artifactThreadId) throw new Error("Review has no artifact thread.");
      const artifactJob = await readJob(job.artifactThreadId);
      if (!artifactJob) throw new Error("Review has no artifact job.");
      const verdicts = [...output.matchAll(/^REVIEW_STATUS: (approved|changes_requested)\s*$/gm)];
      if (!job.legacyReview && verdicts.length !== 1) { await failure(job, childId, "Review has no unambiguous verdict. Inspect its report:\n\n" + output); return; }
      // Legacy reviewers were never asked for a verdict; their findings go through
      // a producer disposition/fix turn, followed by a new explicit-verdict review.
      const verdict = job.legacyReview ? "changes_requested" : verdicts[0][1] as Job["verdict"];
      await saveJob(childId, { ...job, phase: "delivering", verdict });
      if (verdict === "approved") {
        if (!await approvalCurrent(job)) { await invalidateApproval(childId, job, artifactJob); return; }
        const { output: artifact } = await bb.sdk.threads.output({ threadId: job.artifactThreadId });
        if (!artifact?.trim()) throw new Error("Reviewed artifact is missing.");
        await bb.sdk.threads.send({ threadId: job.sourceThreadId, mode: "auto", input: message(`Reviewed ${artifactJob.kind} artifact @thread:${job.artifactThreadId} is ready. Independent review @thread:${childId} approved it. Reconcile the result with the current task; this notice does not authorize implementation, merge or deployment.\n\nComplete artifact:\n\n${artifact}\n\nIndependent review:\n\n${output}`) });
      } else if (job.reviewRound >= workflow.maxReviewRounds) {
        await bb.sdk.threads.send({ threadId: job.sourceThreadId, mode: "auto", input: message(`Artifact @thread:${job.artifactThreadId} still has material findings after ${job.reviewRound} independent reviews. It has not been approved or delivered as completed work. Resolve the remaining blocker. Review @thread:${childId}:\n\n${output}`) });
      } else {
        // Record the next producer phase before sending; its next idle belongs to fixes.
        await saveJob(job.artifactThreadId, { ...artifactJob, phase: "working", reviewRound: job.reviewRound + 1 });
        await bb.sdk.threads.send({ threadId: job.artifactThreadId, mode: "auto", input: message(`${workflow.instructions.fixes}\n\nReview @thread:${childId}:\n\n${output}`) });
      }
      const delivered = { ...job, phase: "delivered" as const, verdict };
      await saveJob(childId, delivered);
      await finishAcceptance(childId, delivered);
    } catch (error) {
      const job = await readJob(childId);
      // Delivered handoffs retry acceptance without sending duplicate messages.
      if (job && job.phase !== "delivered") await saveJob(childId, { ...job, phase: "failed" });
      bb.log.error(`Handoff failed for ${childId}: ${String(error)}`);
    } finally { running.delete(childId); }
  }
  async function approvalCurrent(job: Job) {
    return !!job.artifactThreadId && await column(job.artifactThreadId) === "done" && await artifactRequestId(job.artifactThreadId) === job.artifactRequestId;
  }
  async function invalidateApproval(childId: string, job: Job, artifactJob: Job) {
    if (!job.artifactThreadId) throw new Error("Review has no artifact thread.");
    if (job.reviewRound < workflow.maxReviewRounds) {
      await saveJob(job.artifactThreadId, { ...artifactJob, phase: "working", reviewRound: job.reviewRound + 1 });
      await bb.sdk.threads.send({ threadId: job.sourceThreadId, mode: "auto", input: message(`Artifact @thread:${job.artifactThreadId} changed or resumed after review @thread:${childId}. Its approval covers the earlier revision. The workflow will review the current artifact again after it is Done.`) });
    } else {
      await bb.sdk.threads.send({ threadId: job.sourceThreadId, mode: "auto", input: message(`Artifact @thread:${job.artifactThreadId} changed after the final review round. The current revision is unapproved; resolve this blocker before treating it as complete.`) });
    }
    const delivered = { ...job, phase: "delivered" as const, verdict: "changes_requested" as const };
    await saveJob(childId, delivered); await finishAcceptance(childId, delivered);
  }
  async function finishAcceptance(childId: string, job: Job) {
    if (!job.artifactThreadId) throw new Error("Review has no artifact thread.");
    if (job.verdict === "approved" && !await approvalCurrent(job)) {
      const artifactJob = await readJob(job.artifactThreadId);
      if (!artifactJob) throw new Error("Review has no artifact job.");
      await invalidateApproval(childId, job, artifactJob); return;
    }
    await accept(childId, job.artifactThreadId);
    if (job.verdict === "approved") {
      const artifactJob = await readJob(job.artifactThreadId);
      if (artifactJob?.kind === "plan" || artifactJob?.kind === "design") await accept(job.artifactThreadId, job.sourceThreadId, true, childId);
    }
    await saveJob(childId, { ...job, phase: "done" });
  }

  bb.rpc.register(rpcContract, {
    startPlan: async ({ threadId: id, kind, instruction }) => ({ childThreadId: await spawnJob(id, { kind, sourceThreadId: id, reviewRound: 1, provider: "codex", phase: "working" }, `${workflow.instructions.common}\n\n${workflow.instructions[kind]}\n\nSource thread: @thread:${id}.\n\nLatest composer request:\n${instruction ?? ""}`, true) }),
    startImplementation: async ({ threadId: id, instruction }) => {
      const { output: artifact } = await bb.sdk.threads.output({ threadId: id });
      return { childThreadId: await spawnJob(id, { kind: "implementation", sourceThreadId: id, reviewRound: 1, provider: "codex", phase: "working" }, `${workflow.instructions.common}\n\n${workflow.instructions.implementation}\n\nPlan and source requirements: @thread:${id}. Use bb thread show and bb thread log to read its full artifacts.\n\nLatest composer request:\n${instruction ?? ""}\n\nSource artifact:\n${artifact ?? "No final artifact available; read the source thread."}`) };
    },
  });
  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => deliver(thread.id, lastAssistantText, false));
  bb.events.on("thread.failed", ({ thread, error }) => deliver(thread.id, error, true));
  bb.background.service("recover-handoffs", {
    async start(signal) {
      while (!signal.aborted) {
        for (const id of (await bb.storage.kv.get<string[]>(JOB_IDS)) ?? []) {
          if (signal.aborted) break;
          try {
            const job = await readJob(id);
            if (job?.phase !== "working" && job?.phase !== "delivered") continue;
            const thread = await bb.sdk.threads.get({ threadId: id });
            if (thread.status === "idle" || thread.status === "error") {
              const { output } = await bb.sdk.threads.output({ threadId: id });
              await deliver(id, output, thread.status === "error");
            }
          } catch (error) {
            if (z.object({ code: z.literal("thread_not_found") }).safeParse(error).success) {
              const saved = await bb.storage.kv.get<Job | LegacyJob>(jobKey(id));
              if (saved) await bb.storage.kv.set(jobKey(id), { ...saved, phase: "failed" });
              bb.log.warn(`Retired handoff for deleted thread ${id}.`);
            } else bb.log.error(`Could not inspect handoff ${id}: ${String(error)}`);
          }
        }
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
          const timer = setTimeout(done, 10_000); signal.addEventListener("abort", done, { once: true });
        });
      }
    },
  });
}
