import { useEffect, useState } from "react";
import { useSdk, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";

export type Counts = { backlog: number; waiting: number; active: number; done: number };
export function countThreads(threads: readonly Pick<PluginSidebarThread, "id" | "projectId" | "isHidden" | "isArchived">[], columns: Record<string, unknown>) {
  const counts: Record<string, Counts> = {};
  for (const thread of threads) {
    if (thread.isHidden || thread.isArchived) continue;
    const value = columns[thread.id];
    const column = value === "active" || value === "in-progress" ? "active"
      : value === "done" || value === "review" ? "done"
      : value === "waiting" || value === "blocked" ? "waiting" : "backlog";
    const project = counts[thread.projectId] ??= {backlog: 0, waiting: 0, active: 0, done: 0};
    project[column]++;
  }
  return counts;
}

export function sumProjectCounts(projectIds: readonly string[], counts: Record<string, Counts>): Counts {
  const total: Counts = {backlog: 0, waiting: 0, active: 0, done: 0};
  for (const id of projectIds) {
    const count = counts[id];
    if (count) for (const column of ["backlog", "waiting", "active", "done"] as const) total[column] += count[column];
  }
  return total;
}

/** Board columns are persisted by Kanban, independently of runtime activity. */
export function useThreadCounts(threads: readonly PluginSidebarThread[]) {
  const sdk = useSdk();
  const [counts, setCounts] = useState<Record<string, Counts>>({});
  const [error, setError] = useState(false);
  const key = JSON.stringify(threads.filter(t => !t.isHidden && !t.isArchived).map(t => [t.id, t.projectId]).sort());
  useEffect(() => {
    const rows = (JSON.parse(key) as [string, string][]).map(([id, projectId]) => ({id, projectId, isHidden: false, isArchived: false}));
    let disposed = false;
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const columns: Record<string, unknown> = {};
        for (let i = 0; i < rows.length && !disposed; i += 20) {
          const batch = await Promise.all(rows.slice(i, i + 20).map(async row => {
            const metadata = await sdk.threads.getPluginMetadata({threadId: row.id, pluginId: "kanban"});
            return [row.id, metadata.column] as const;
          }));
          for (const [id, column] of batch) columns[id] = column;
        }
        if (!disposed) { setCounts(countThreads(rows, columns)); setError(false); }
      } catch { if (!disposed) { setCounts({}); setError(true); } }
      finally { pending = false; }
    };
    setCounts({});
    void refresh();
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [sdk, key]);
  return {counts, error};
}

export function ThreadCounts({counts, compact = false}: {counts?: Counts; compact?: boolean}) {
  if (!counts) return null;
  const total = counts.backlog + counts.active + counts.waiting + counts.done;
  if (!total) return null;
  if (compact) {
    const summary = [
      counts.backlog && `${counts.backlog} Backlog`, counts.active && `${counts.active} Active`,
      counts.waiting && `${counts.waiting} Waiting`, counts.done && `${counts.done} Done`,
    ].filter(Boolean).join(", ");
    return <span role="img" title={summary} aria-label={`${total} ${total === 1 ? "thread" : "threads"}: ${summary}`} className="inline-flex shrink-0 items-center gap-1 text-[10px] font-normal tabular-nums text-muted-foreground">
      {counts.waiting > 0 && <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />}
      {counts.waiting === 0 && counts.active > 0 && <span aria-hidden className="size-1.5 rounded-full bg-blue-500" />}
      <span aria-hidden>{total}</span>
    </span>;
  }
  return <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] leading-4 tabular-nums">
    {counts.backlog > 0 && <span className="text-muted-foreground">{counts.backlog} Backlog</span>}
    {counts.active > 0 && <span className="text-blue-600 dark:text-blue-300">{counts.active} Active</span>}
    {counts.waiting > 0 && <span className="text-amber-700 dark:text-amber-300">{counts.waiting} Waiting</span>}
    {counts.done > 0 && <span className="text-emerald-700 dark:text-emerald-300">{counts.done} Done</span>}
  </span>;
}
