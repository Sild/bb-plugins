import { workflowParent } from "./workflow-parent";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Card } from "./server";
import { isWorking } from "./board";

export type ArchiveScope = { kind: "accepted"; projectIds: string[] | null } | { kind: "project"; projectId: string };

/** The host archives dependency trees, so reject roots that would cross the requested scope. */
export async function archiveScope(bb: BbPluginApi, scope: ArchiveScope, cardFor: (id: string) => Promise<Card>, classifyInitial = cardFor) {
  const readRows = async () => {
    const rows: Awaited<ReturnType<typeof bb.sdk.threads.list>> = [];
    for (const archived of [false, true]) {
      for (let offset = 0; ; offset += 500) {
        const page = await bb.sdk.threads.list({ archived, includeHidden: true, limit: 500, offset });
        rows.push(...page);
        if (page.length < 500) break;
      }
    }
    return rows;
  };
  let rows = await readRows();
  const candidates = rows.filter(t => t.archivedAt === null && (scope.kind === "project"
    ? t.projectId === scope.projectId
    : t.visibility === "visible" && (scope.projectIds === null || scope.projectIds.includes(t.projectId))));
  const eligible = new Set<string>();
  const archived = new Set<string>();
  const failures: { threadId: string; reason: string }[] = [];
  for (const row of candidates) {
    try {
      if (scope.kind === "project" || (await classifyInitial(row.id)).column === "accepted") eligible.add(row.id);
    } catch (cause) {
      failures.push({threadId: row.id, reason: cause instanceof Error ? cause.message : String(cause)});
    }
  }
  for (const id of eligible) {
    if (archived.has(id)) continue;
    try {
      rows = await readRows();
      const current = rows.find(row => row.id === id);
      if (!current || current.archivedAt !== null) continue;
      const children = new Map<string, typeof rows>();
      for (const row of rows) {
        const parents = new Set([await workflowParent(bb, row), row.lifecycleOwnerThreadId, row.visibility === "hidden" ? row.sourceThreadId : null]);
        for (const parent of parents) if (parent) children.set(parent, [...(children.get(parent) ?? []), row]);
      }
      const tree = new Set<string>();
      const pending = [id];
      while (pending.length) {
        const next = pending.pop()!;
        if (tree.has(next)) continue;
        tree.add(next);
        for (const child of children.get(next) ?? []) pending.push(child.id);
      }
      // Archived descendants are not targets, but traverse them to find live descendants.
      if (rows.some(t => tree.has(t.id) && t.archivedAt !== null && (isWorking(t.runtime.displayStatus) || t.activity.activeBackgroundAgentCount > 0))) throw new Error("An archived dependent is still stopping. Retry after it settles.");
      const live = rows.filter(t => tree.has(t.id) && t.archivedAt === null && !archived.has(t.id));
      if (live.some(t => !eligible.has(t.id) || (scope.kind === "project" ? t.projectId !== scope.projectId : t.visibility !== "visible" || scope.projectIds !== null && !scope.projectIds.includes(t.projectId)))) throw new Error("Contains child or dependent tasks outside this archive selection.");
      if (scope.kind === "accepted") {
        for (const row of live) if ((await cardFor(row.id)).column !== "accepted") throw new Error("A task is no longer Accepted. Refresh and retry.");
      }
      const result = await bb.sdk.threads.archive({ threadId: id });
      result.archivedThreadIds.forEach(value => archived.add(value));
    } catch (cause) {
      failures.push({threadId: id, reason: cause instanceof Error ? cause.message : String(cause)});
    }
  }
  return { archived: archived.size, failed: failures.length, failures: failures.slice(0, 20) };
}
