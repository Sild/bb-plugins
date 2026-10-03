import { stagedSnapshotSchema } from "./git-contract";
import { workflowParent } from "./workflow-parent";
import { cliCommand, defineCli, defineRpcContract, PluginCliError, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { archiveScope } from "./archive";
import { projectFolders, deriveColumn, isWorking, type AgentState } from "./board";
import { mergeWorkflow } from "./merging";
import { registerTaskEnvironment } from "./task-environment";
import { newTaskDefaults } from "./new-task-defaults";

const columnSchema = z.enum(["backlog", "waiting", "active", "done", "accepted", "archived"]);
const cardSchema = z.object({
  id: z.string(), projectId: z.string(), title: z.string(), parentThreadId: z.string().nullable().optional(),
  acceptedAt: z.number().nullable().optional(),
  reviewRequired: z.boolean().optional(),
  merging: z.boolean().optional(), mergeError: z.string().nullable().optional(),
  column: columnSchema, status: z.string(), updatedAt: z.number(),
});
export type Card = z.infer<typeof cardSchema>;
const projectSchema = z.object({ id: z.string(), name: z.string(), isPersonal: z.boolean() });
const folderSchema = z.object({
  id: z.string(), name: z.string(), sign: z.string(), iconName: z.string().nullable(),
  iconColor: z.string().nullable(), projectIds: z.array(z.string()),
});
const groupsSchema = z.object({
  groups: z.array(z.object({
    id: z.string(), name: z.string(), sign: z.string(), position: z.number(),
    iconName: z.string().nullable(), iconColor: z.string().regex(/^#[a-f\d]{6}$/i),
  })),
  assignments: z.record(z.string(), z.string()),
  pinnedProjectIds: z.array(z.string()),
});
const boardSchema = z.object({
  cards: z.array(cardSchema), projects: z.array(projectSchema), folders: z.array(folderSchema),
  archiveUndated: z.number().optional(), archiveTruncated: z.boolean().optional(),
  truncated: z.boolean(), folderWarning: z.string().nullable(),
});
export type BoardData = z.infer<typeof boardSchema>;

export const rpcContract = defineRpcContract({
  board_default_environment: {
    input: z.object({ projectId: z.string(), hostId: z.string().nullable() }),
    output: z.object({ hostId: z.string(), branch: z.string(), environmentProviderId: z.string() }).nullable(),
  },
  board_task_defaults: {
    input: z.object({ projectId: z.string().nullable(), hostId: z.string().nullable() }),
    output: z.object({ providerId: z.literal("codex"), model: z.string(), reasoningLevel: z.literal(newTaskDefaults.reasoning), environment: z.object({ hostId: z.string(), environmentProviderId: z.string() }).nullable() }),
  },
  board_accept_plan: {
    input: z.object({ threadId: z.string().min(1), parentThreadId: z.string().min(1), reviewThreadId: z.string().min(1) }),
    output: cardSchema,
  },
  board_retry_merge: { input: z.object({ threadId: z.string() }), output: cardSchema },
  board_list: {
    // null means all projects; [] deliberately selects none.
    input: z.object({ projectIds: z.array(z.string().min(1)).max(500).nullable(), archiveDays: z.union([z.literal(1), z.literal(7), z.literal(14), z.literal(30), z.literal(90), z.literal(180), z.literal(365)]).nullable().optional() }),
    output: boardSchema,
  },
  board_done: {
    input: z.object({ projectIds: z.array(z.string().min(1)).max(500).nullable() }),
    output: z.array(cardSchema),
  },
  board_accept_all: {
    input: z.object({ projectIds: z.array(z.string().min(1)).max(500).nullable(), revisions: z.array(z.object({ threadId: z.string().min(1), expectedUpdatedAt: z.number() })) }),
    output: z.object({ accepted: z.number(), merging: z.number(), failed: z.number(), failures: z.array(z.object({ threadId: z.string(), reason: z.string() })) }),
  },
  board_archive: {
    input: z.discriminatedUnion("kind", [
      z.object({kind: z.literal("accepted"), projectIds: z.array(z.string().min(1)).max(500).nullable()}),
      z.object({kind: z.literal("project"), projectId: z.string().min(1)}),
    ]),
    output: z.object({archived: z.number(), failed: z.number(), failures: z.array(z.object({threadId: z.string(), reason: z.string()}))}),
  },
  board_thread: {
    input: z.object({ threadId: z.string().min(1) }),
    output: cardSchema,
  },
  board_accept: {
    input: z.object({ threadId: z.string().min(1), expectedUpdatedAt: z.number(), acknowledgeChanges: z.boolean().optional() }),
    output: cardSchema,
  },
  board_accept_review: {
    input: z.object({ threadId: z.string().min(1), parentThreadId: z.string().min(1) }),
    output: cardSchema,
  },
});

const CHANGED = "board-changed";
const MAX_THREADS = 500;

export default function plugin(bb: BbPluginApi) {
  registerTaskEnvironment(bb);
  async function latestRequest(threadId: string) {
    const events = await bb.sdk.threads.events.list({ threadId, types: ["client/turn/requested", "turn/started"], order: "desc", limit: "1" });
    return events[0]?.id ?? null;
  }
  const merges = mergeWorkflow(bb, threadId => bb.realtime.publish(CHANGED, { threadId }), latestRequest);

  // Read child relationships independently of visible cards and project filters.
  // Hidden children and grandchildren still keep their ancestors working.
  async function activeAncestors(): Promise<Set<string>> {
    const children: Awaited<ReturnType<typeof bb.sdk.threads.list>> = [];
    for (const relation of [{ hasParent: true as const }, { originPluginId: "review-implement" }]) {
      for (let offset = 0; ; offset += MAX_THREADS) {
        const page = await bb.sdk.threads.list({ ...relation, archived: false, includeHidden: true, limit: MAX_THREADS, offset });
        children.push(...page);
        if (page.length < MAX_THREADS) break;
      }
    }
    const parents = new Map(await Promise.all(children.map(async child => [child.id, await workflowParent(bb, child)] as const)));
    const active = new Set<string>();
    for (const child of children) {
      if (!isWorking(child.runtime.displayStatus) && child.activity.activeBackgroundAgentCount === 0) continue;
      const visited = new Set<string>([child.id]);
      let parent = parents.get(child.id);
      while (parent && !visited.has(parent)) {
        visited.add(parent);
        active.add(parent);
        parent = parents.get(parent) ?? null;
      }
    }
    return active;
  }

  type ThreadInfo = { originPluginId?: string | null; parentThreadId?: string | null; id: string; projectId: string; title: string | null; titleFallback?: string | null; status: string; updatedAt: number; runtime: { displayStatus: string } };
  async function cardFor(thread: ThreadInfo, state: Pick<AgentState, "hasPendingInteraction" | "activeBackgroundAgentCount" | "hasActiveDescendant">): Promise<Card> {
    const metadata = await bb.sdk.threads.getPluginMetadata({ threadId: thread.id });
    const requestId = metadata.outcome === "done" ? await latestRequest(thread.id) : null;
    const completionReported = requestId !== null && metadata.outcomeRequestId === requestId;
    return {
      id: thread.id, projectId: thread.projectId, parentThreadId: await workflowParent(bb, thread),
      title: thread.title || thread.titleFallback || thread.id,
      column: metadata.merging === true ? "active" : deriveColumn({ ...state, completionReported, status: thread.status, runtimeStatus: thread.runtime.displayStatus, updatedAt: thread.updatedAt }, metadata.acceptedFor),
      merging: metadata.merging === true, mergeError: typeof metadata.mergeError === "string" ? metadata.mergeError : null,
      status: thread.status, updatedAt: thread.updatedAt,
      acceptedAt: typeof metadata.acceptedAt === "number" && Number.isFinite(metadata.acceptedAt) ? metadata.acceptedAt : null,
    };
  }

  async function threadCard(threadId: string, ancestors = activeAncestors()) {
    const [thread, interactions, activeParents] = await Promise.all([
      bb.sdk.threads.get({ threadId }), bb.sdk.threads.interactions.list({ threadId }), ancestors,
    ]);
    return cardFor(thread, { hasActiveDescendant: activeParents.has(thread.id), hasPendingInteraction: interactions.length > 0, activeBackgroundAgentCount: thread.activeBackgroundAgentCount });
  }

  async function readFolders() {
    try {
      const groups = await bb.sdk.plugins.callRpc({
        pluginId: "project-groups", method: "groups_list", input: null, outputSchema: groupsSchema,
      });
      return { groups, warning: null };
    } catch (cause) {
      bb.log.warn(`Could not read project folders: ${cause instanceof Error ? cause.message : String(cause)}`);
      return { groups: null, warning: "Project folders are unavailable. Projects are shown without folders; refresh to retry." };
    }
  }

  async function list(projectIds: string[] | null, archiveDays?: number | null): Promise<BoardData> {
    const [projectRows, folderState] = await Promise.all([
      bb.sdk.projects.list({ includePersonal: true }), readFolders(),
    ]);
    const projects = projectRows.map((project) => ({ id: project.id, name: project.kind === "personal" ? "Other threads" : project.name, isPersonal: project.kind === "personal" }));
    const knownIds = new Set(projects.map((project) => project.id));
    const filters = projectIds === null ? [undefined] : [...new Set(projectIds)].filter((id) => knownIds.has(id));
    const threads: Awaited<ReturnType<typeof bb.sdk.threads.list>> = [];
    // Query selected projects before limiting, so busy unselected projects cannot hide their cards.
    for (let index = 0; index < filters.length; index += 10) {
      const pages = await Promise.all(filters.slice(index, index + 10).map((projectId) =>
        bb.sdk.threads.list({ ...(projectId ? { projectId } : {}), archived: false, includeHidden: false, limit: MAX_THREADS + 1 })));
      threads.push(...pages.flat());
    }
    threads.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    const visible = threads.filter((thread) => thread.visibility === "visible" && thread.archivedAt === null);
    const selected = visible.slice(0, MAX_THREADS);
    const ancestors = selected.length ? await activeAncestors() : new Set<string>();
    const cards: Card[] = [];
    for (let index = 0; index < selected.length; index += 20) {
      cards.push(...await Promise.all(selected.slice(index, index + 20).map((thread) => cardFor(thread, { hasActiveDescendant: ancestors.has(thread.id), hasPendingInteraction: thread.hasPendingInteraction, activeBackgroundAgentCount: thread.activity.activeBackgroundAgentCount }))));
    }
    let archiveUndated = 0;
    let archiveTruncated = false;
    if (archiveDays != null) {
      const cutoff = Date.now() - archiveDays * 86400000;
      const archivedCards: Card[] = [];
      for (const projectId of filters) {
        for (let offset = 0; ; offset += MAX_THREADS) {
          const page = await bb.sdk.threads.list({ ...(projectId ? {projectId} : {}), archived: true, includeHidden: false, limit: MAX_THREADS, offset });
          for (const thread of page) {
            if (thread.archivedAt === null || thread.visibility !== "visible") continue;
            const metadata = await bb.sdk.threads.getPluginMetadata({threadId: thread.id});
            const acceptedAt = typeof metadata.acceptedAt === "number" && Number.isFinite(metadata.acceptedAt) ? metadata.acceptedAt : null;
            if (acceptedAt === null) archiveUndated++;
            else if (acceptedAt < cutoff || acceptedAt > Date.now()) continue;
            archivedCards.push({id: thread.id, projectId: thread.projectId, title: thread.title || thread.titleFallback || thread.id,
              parentThreadId: await workflowParent(bb, thread), status: thread.status, updatedAt: thread.updatedAt, column: "archived", acceptedAt});
          }
          if (page.length < MAX_THREADS) break;
        }
      }
      archivedCards.sort((a,b) => (b.acceptedAt ?? 0) - (a.acceptedAt ?? 0) || a.id.localeCompare(b.id));
      archiveTruncated = archivedCards.length > MAX_THREADS;
      cards.push(...archivedCards.slice(0, MAX_THREADS));
    }
    return { archiveUndated, archiveTruncated, cards, projects, folders: projectFolders(projects, folderState.groups), truncated: visible.length > MAX_THREADS, folderWarning: folderState.warning };
  }

  async function accept(threadId: string, expectedUpdatedAt: number, acknowledgeChanges = false): Promise<Card> {
    const card = await threadCard(threadId);
    if (card.column !== "done") throw new Error("Only a Done thread can be accepted. Refresh to see its current status.");
    if (card.updatedAt !== expectedUpdatedAt && !acknowledgeChanges) return { ...card, reviewRequired: true };
    await merges.checkDone(threadId);
    const metadata = await bb.sdk.threads.getPluginMetadata({ threadId });
    if (metadata.stagedAcceptance) {
      const prepared = z.object({ environmentId: z.string(), path: z.string(), message: z.string(), snapshot: stagedSnapshotSchema }).parse(metadata.stagedAcceptance);
      const thread = await bb.sdk.threads.get({ threadId });
      if (thread.environmentId !== prepared.environmentId) throw new Error("The task environment changed since Done. Review and report Done again.");
      const environment = await bb.sdk.environments.get({ environmentId: prepared.environmentId });
      if (environment.path !== prepared.path || environment.status !== "ready") throw new Error("The task checkout is unavailable or changed since Done.");
      await merges.host.call("commitStaged", { path: prepared.path, snapshot: prepared.snapshot, message: prepared.message }, { hostId: environment.hostId, timeoutMs: 180_000 });
    }
    if (await merges.begin(threadId)) return threadCard(threadId);
    await bb.sdk.threads.updatePluginMetadata({ threadId, set: { acceptedFor: card.updatedAt, acceptedAt: Date.now() } });
    bb.realtime.publish(CHANGED, { threadId });
    return threadCard(threadId);
  }

  async function doneCards(projectIds: string[] | null): Promise<Card[]> {
    const filters = projectIds === null ? [undefined] : [...new Set(projectIds)];
    if (!filters.length) return [];
    const ancestors = await activeAncestors();
    const cards: Card[] = [];
    for (const projectId of filters) {
      for (let offset = 0; ; offset += MAX_THREADS) {
        const page = await bb.sdk.threads.list({ ...(projectId ? { projectId } : {}), archived: false, includeHidden: false, limit: MAX_THREADS, offset });
        for (let index = 0; index < page.length; index += 20) {
          const batch = await Promise.all(page.slice(index, index + 20).filter(thread => thread.visibility === "visible" && thread.archivedAt === null).map(thread => cardFor(thread, {
            hasActiveDescendant: ancestors.has(thread.id), hasPendingInteraction: thread.hasPendingInteraction, activeBackgroundAgentCount: thread.activity.activeBackgroundAgentCount,
          })));
          cards.push(...batch.filter(card => card.column === "done"));
        }
        if (page.length < MAX_THREADS) break;
      }
    }
    return cards;
  }

  async function acceptAll(projectIds: string[] | null, revisions: { threadId: string; expectedUpdatedAt: number }[]) {
    const result = { accepted: 0, merging: 0, failed: 0, failures: [] as { threadId: string; reason: string }[] };
    const seen = new Set<string>();
    for (const revision of revisions) {
      if (seen.has(revision.threadId)) continue;
      seen.add(revision.threadId);
      try {
        const thread = await bb.sdk.threads.get({ threadId: revision.threadId });
        if (thread.visibility !== "visible" || thread.archivedAt !== null || (projectIds !== null && !projectIds.includes(thread.projectId))) throw new Error("Task is outside the selected visible, unarchived threads.");
        const card = await accept(revision.threadId, revision.expectedUpdatedAt);
        if (card.reviewRequired) throw new Error("Task changed since the preview. Review it before accepting.");
        if (card.mergeError) throw new Error(card.mergeError);
        if (card.column === "accepted") result.accepted++;
        else if (card.merging) result.merging++;
        else throw new Error("Task changed during acceptance. Refresh to see its current status.");
      } catch (cause) {
        result.failed++;
        if (result.failures.length < 20) result.failures.push({ threadId: revision.threadId, reason: cause instanceof Error ? cause.message : String(cause) });
      }
    }
    return result;
  }

  async function defaultEnvironment(projectId: string, hostId: string | null) {
    const project = await bb.sdk.projects.get({ projectId });
    if (project.kind === "personal") return null;
    const sources = project.sources.filter(source => source.type === "local_path" && (!hostId || source.hostId === hostId));
    const source = sources.find(source => source.isDefault) ?? (sources.length === 1 ? sources[0] : null);
    if (!source?.path || !source.hostId) return null;
    const state = await merges.host.call("inspect", { path: source.path }, { hostId: source.hostId });
    if (!state.isGit) return null;
    if (!state.branch) throw new Error("Choose a checked-out branch before starting a task.");
    return { hostId: source.hostId, branch: state.branch, environmentProviderId: newTaskDefaults.environmentProvider };
  }

  async function acceptDeliveredArtifact(threadId: string): Promise<Card> {
    const thread = await bb.sdk.threads.get({ threadId });
    const card = await threadCard(threadId);
    if (card.column === "accepted") return card;
    if (thread.status !== "idle" || card.column !== "done") throw new Error("The artifact must be idle and Done before automatic acceptance.");
    await bb.sdk.threads.updatePluginMetadata({ threadId, set: { acceptedFor: card.updatedAt, acceptedAt: Date.now() } });
    bb.realtime.publish(CHANGED, { threadId });
    return threadCard(threadId);
  }

  async function acceptDeliveredReview(threadId: string, parentThreadId: string): Promise<Card> {
    const thread = await bb.sdk.threads.get({ threadId });
    if (await workflowParent(bb, thread) !== parentThreadId || !/^(?:\[👁](?:\[(?:PLAN|DESIGN|<\/>)])? .+|\[REVIEW\]\[.+\]|↳ (?:Implementation review|Review): .+)$/.test(thread.title ?? "")) {
      throw new Error("Only a review subthread can be accepted automatically.");
    }
    return acceptDeliveredArtifact(threadId);
  }

  bb.agents.configure(() => ({
    tools: [], skills: ["kanban-board"],
    instructions: "For Git tasks, validate and self-review, then stage only task-owned hunks and report Done with `bb kanban report done --commit-message \"scope: summary\"`. Leave changes uncommitted for review; the user clicking Accept authorizes the plugin to commit the captured staged changes, then merge a managed worktree if applicable. Preserve unrelated staged and unstaged changes; if ownership of existing staged changes is ambiguous, ask rather than include them. Read-only/no-change tasks report Done without a commit message and create no commit. Never commit before Accept unless the user explicitly requests it. Accept authorizes the plugin to merge and clean up; never accept work yourself. Before ending each turn, report your task outcome once with the bb CLI. For changes use the commit-message form above; for read-only/no-change work run `bb kanban report done` when your assigned work is complete, including a review whose findings have been delivered to its parent. Findings, recommendations, or future work for someone else do not make a completed review Waiting. Run `bb kanban report waiting` only when your own task needs user input to proceed. Waiting for a running subtask remains Active. Do not omit the outcome report: idle alone cannot distinguish completion from an unanswered question. Never accept work on the user's behalf.",
  }));
  bb.rpc.register(rpcContract, {
    board_default_environment: ({ projectId, hostId }) => defaultEnvironment(projectId, hostId),
    board_task_defaults: async ({ projectId, hostId }) => ({
      providerId: newTaskDefaults.provider, model: newTaskDefaults.model, reasoningLevel: newTaskDefaults.reasoning,
      environment: projectId ? await defaultEnvironment(projectId, hostId) : null,
    }),
    board_accept_plan: async ({ threadId, parentThreadId, reviewThreadId }) => {
      const thread = await bb.sdk.threads.get({ threadId });
      if (await workflowParent(bb, thread) !== parentThreadId || !/^\[(?:PLAN|DESIGN)\] .+/.test(thread.title ?? "")) throw new Error("Only a reviewed plan subthread can be accepted automatically.");
      const review = await bb.sdk.threads.get({ threadId: reviewThreadId });
      if (await workflowParent(bb, review) !== threadId || !/^\[👁\](?:\[(?:PLAN|DESIGN)\])? .+/.test(review.title ?? "") || (await threadCard(reviewThreadId)).column !== "accepted") throw new Error("The plan needs an accepted independent review before automatic acceptance.");
      return acceptDeliveredArtifact(threadId);
    },
    board_retry_merge: async ({ threadId }) => { await merges.retry(threadId); return threadCard(threadId); },
    board_list: ({ projectIds, archiveDays }) => list(projectIds, archiveDays),
    board_done: ({ projectIds }) => doneCards(projectIds),
    board_accept_all: ({ projectIds, revisions }) => acceptAll(projectIds, revisions),
    board_archive: async (scope) => {
      let ancestors: Promise<Set<string>> | undefined;
      const result = await archiveScope(bb, scope, threadCard, id => threadCard(id, ancestors ??= activeAncestors()));
      bb.realtime.publish(CHANGED, {});
      return result;
    },
    board_thread: ({ threadId }) => threadCard(threadId),
    board_accept: ({ threadId, expectedUpdatedAt, acknowledgeChanges }) => accept(threadId, expectedUpdatedAt, acknowledgeChanges),
    board_accept_review: ({ threadId, parentThreadId }) => acceptDeliveredReview(threadId, parentThreadId),
  });
  bb.cli.register(defineCli({
    name: "kanban", summary: "List thread cards with status derived from agent activity",
    commands: {
      report: cliCommand({
        summary: "Report whether the current task is complete or waiting for input",
        options: { "commit-message": { type: "string", description: "Prepare staged task-owned changes for committing when the user clicks Accept" } },
        positionals: [{ name: "outcome", description: "done or waiting", required: true }],
        async run(input, ctx) {
          if (!ctx.threadId) throw new PluginCliError("Run this command from the agent's current thread.");
          const outcome = z.enum(["done", "waiting"]).safeParse(input.positionals.outcome);
          if (!outcome.success) throw new PluginCliError("Outcome must be done or waiting.");
          const outcomeRequestId = await latestRequest(ctx.threadId);
          if (!outcomeRequestId) throw new PluginCliError("No current turn to report.");
          if (outcome.data === "done") await merges.checkDone(ctx.threadId);
          let stagedAcceptance = null;
          const commitMessage = input.options["commit-message"];
          if (commitMessage !== undefined) {
            if (outcome.data !== "done" || typeof commitMessage !== "string" || !commitMessage.trim() || commitMessage.length > 500) throw new PluginCliError("Use a nonempty commit message (up to 500 characters) with report done.");
            const thread = await bb.sdk.threads.get({ threadId: ctx.threadId });
            if (!thread.environmentId) throw new PluginCliError("No task checkout is available.");
            const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
            if (!environment.isGitRepo || !environment.path) throw new PluginCliError("The task is not in a Git checkout.");
            const snapshot = await merges.host.call("stagedSnapshot", { path: environment.path }, { hostId: environment.hostId });
            stagedAcceptance = { environmentId: environment.id, path: environment.path, message: commitMessage.trim(), snapshot };
          }
          await bb.sdk.threads.updatePluginMetadata({ threadId: ctx.threadId, set: { outcome: outcome.data, outcomeRequestId, acceptedFor: null, stagedAcceptance } });
          if (outcome.data === "done") await merges.reportDone(ctx.threadId);
          bb.realtime.publish(CHANGED, { threadId: ctx.threadId });
          return { exitCode: 0, stdout: `Task outcome: ${outcome.data}` };
        },
      }),
      list: cliCommand({
        summary: "List board cards; repeat --project to select several projects",
        options: {
          project: { type: "string", repeatable: true, description: "Only show this project ID; repeat for multiple projects" },
          json: { type: "boolean", description: "Print JSON" },
        },
        async run(input) {
          const board = await list(input.options.project?.length ? input.options.project : null);
          const output = input.options.json ? JSON.stringify(board)
            : board.cards.map((card) => `${card.column.padEnd(8)} ${card.id}  ${card.title}`).join("\n") || "No visible threads.";
          return { exitCode: 0, stdout: output + (board.truncated && !input.options.json ? "\nShowing the latest 500 selected threads." : "") };
        },
      }),
    },
  }));

  for (const event of ["thread.created", "thread.active", "thread.idle", "thread.failed", "thread.archived", "thread.unarchived", "thread.deleted", "interaction.pending", "experimental_thread.events"] as const) {
    bb.events.on(event, ({ thread }) => bb.realtime.publish(CHANGED, { threadId: thread.id }));
  }
}
