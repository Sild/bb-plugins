import * as Tooltip from "@radix-ui/react-tooltip";
import { useCallback, useEffect, useRef, useState } from "react";
import { definePluginApp, experimental_useSidebarThreadActions, useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { BoardData, rpcContract } from "./server";
import { columns, archivedColumn, archivePeriods } from "./board";
import { FolderMark, ProjectFilter } from "./ProjectFilter";
import { ProjectCards } from "./ProjectCards";
import { ThreadActions } from "./ThreadActions";
import { ThreadAcceptance } from "./ThreadAcceptance";
import { NewThreadWorktree } from "./NewThreadWorktree";
import { ActiveBranchInputs } from "./ActiveBranchInputs";
import { taskWorktreeProvider } from "./task-worktree-provider";
import { ArchiveIcon, ProjectArchiveMenu } from "./ProjectArchiveMenu";
import { AcceptAllButton, AcceptAllDialog } from "./AcceptAllDialog";
import { ArchiveDialog } from "./ArchiveDialog";
import { SaveDraftAction } from "./SaveDraftAction";
import type { ArchiveScope } from "./archive";
import { useBoardPreference } from "./useBoardPreference";
import { mountAgentPickerFocus } from "./AgentPickerFocus";

function Board() {
  const rpc = useRpc<typeof rpcContract>();
  const threadActions = experimental_useSidebarThreadActions();
  const [showArchive, setShowArchive, archivePreferenceError] = useBoardPreference("showArchive", false);
  const [archiveDays, setArchiveDays] = useState<1 | 7 | 14 | 30 | 90 | 180 | 365>(7);
  const [archive, setArchive] = useState<{scope: ArchiveScope; label: string} | null>(null);
  const [acceptAll, setAcceptAll] = useState<{projectIds: string[] | null; label: string} | null>(null);
  const shownColumns = showArchive ? [...columns, archivedColumn] : columns;
  const [showLinks, setShowLinks, linksPreferenceError] = useBoardPreference("showLinks", true);
  const [parentOnly, setParentOnly, parentPreferenceError] = useBoardPreference("parentOnly", false);
  const preferenceError = archivePreferenceError || linksPreferenceError || parentPreferenceError;
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => new Set());
  const connection = useRealtimeConnectionState();
  const [projectIds, setProjectIds] = useState<string[] | null>(null);
  const [data, setData] = useState<BoardData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++request.current;
    try {
      const result = await rpc.call("board_list", { projectIds, archiveDays: showArchive ? archiveDays : null });
      if (current !== request.current) return;
      setData(result);
      setLoadError(null);
    } catch (cause) {
      if (current === request.current) setLoadError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [rpc, projectIds, showArchive, archiveDays]);
  useEffect(() => {
    void refresh();
    return () => { request.current++; };
  }, [refresh]);
  useRealtime("board-changed", refresh);
  // Signals are ephemeral: reconnecting clients must reconcile durable state.
  const previousConnection = useRef(connection);
  useEffect(() => {
    if (connection === "connected" && previousConnection.current !== "connected") void refresh();
    previousConnection.current = connection;
  }, [connection, refresh]);
  useEffect(() => {
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const visibleIds = new Set(projectIds ?? data?.projects.map((project) => project.id));
  const allVisibleCards = data?.cards.filter((card) => visibleIds.has(card.projectId) && (showArchive || card.column !== "archived")) ?? [];
  const visibleCards = parentOnly ? allVisibleCards.filter((card) => !card.parentThreadId) : allVisibleCards;
  const projectsWithCards = new Set(visibleCards.map((card) => card.projectId));
  const projects = data?.folders.flatMap((folder) => folder.projectIds.map((id) => ({ project: data.projects.find((project) => project.id === id), folder })))
    .filter((row) => row.project && projectsWithCards.has(row.project.id)) ?? [];

  return <div data-kanban-board="" className="h-full min-h-0 overflow-auto p-4 md:p-6">
    {acceptAll && <AcceptAllDialog {...acceptAll} close={() => setAcceptAll(null)} refresh={() => void refresh()} />}
    {archive && <ArchiveDialog {...archive} close={() => setArchive(null)} refresh={() => void refresh()} />}
    <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Projects</span>
      <ProjectFilter projects={data?.projects ?? []} folders={data?.folders ?? []} selectedIds={projectIds} onChange={setProjectIds} onOpen={() => void refresh()} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-l border-border pl-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={parentOnly} onChange={(event) => setParentOnly(event.target.checked)} />Parent only</label>
        <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={showLinks} onChange={(event) => setShowLinks(event.target.checked)} />Show links</label>
        <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={showArchive} onChange={event => setShowArchive(event.target.checked)} />Show archive</label>
        {showArchive && <select aria-label="Archive time frame" title="Archive time frame" className="rounded-md border border-border bg-background px-2 py-1 text-sm" value={archiveDays} onChange={event => setArchiveDays(Number(event.target.value) as typeof archiveDays)}>{archivePeriods.map(period => <option key={period.days} value={period.days}>{period.label}</option>)}</select>}
      </div>
      <div className="ml-auto flex items-center gap-3">
        <span role="status" className="text-xs tabular-nums text-muted-foreground">{data ? `${visibleCards.length} ${visibleCards.length === 1 ? "thread" : "threads"}` : "Loading threads…"}</span>
        <button type="button" className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void refresh()}>Refresh</button>
      </div>
    </div>
    {preferenceError && <p role="alert" className="mb-3 text-sm text-destructive">{preferenceError}</p>}
    {loadError && <p role="alert" className="mb-3 text-sm text-destructive">{loadError}</p>}
    {data?.folderWarning && <p role="status" className="mb-3 text-sm text-muted-foreground">{data.folderWarning}</p>}
    {data?.truncated && <p role="status" className="mb-3 text-sm text-muted-foreground">Showing the latest 500 threads in the selected projects. Select fewer projects to see older threads.</p>}
    {showArchive && !!data?.archiveUndated && <p role="status" className="mb-3 text-xs text-muted-foreground">{data.archiveUndated} archived tasks have no recorded acceptance time and are included regardless of the time filter.</p>}
    {showArchive && data?.archiveTruncated && <p role="status" className="mb-3 text-xs text-muted-foreground">Showing the 500 most recently accepted archived tasks in this period.</p>}
    {!data ? <p className="text-sm text-muted-foreground">{loadError ? "Use Refresh to retry." : "Loading threads…"}</p> :
      <div className={`${showArchive ? "min-w-[1200px]" : "min-w-[1000px]"} space-y-4`}>
        <div className="sticky top-0 z-10 grid gap-3 rounded-lg border border-border bg-background/95 px-3 py-3 shadow-sm" style={{gridTemplateColumns: `repeat(${shownColumns.length}, minmax(0, 1fr))`}}>
          {shownColumns.map((column) => <div key={column.id}>
            <h2 className="flex items-center gap-2 text-sm font-semibold">{column.label}<span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{visibleCards.filter((card) => card.column === column.id).length}</span>
              {column.id === "done" && <AcceptAllButton label="Accept all Done tasks" disabled={!visibleIds.size} onClick={() => setAcceptAll({projectIds, label: "Accept all Done tasks in selected projects?"})} />}
              {column.id === "accepted" && <Tooltip.Provider delayDuration={150}><Tooltip.Root>
                <Tooltip.Trigger asChild><button type="button" disabled={!visibleIds.size} aria-label="Archive all accepted tasks" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" onClick={() => setArchive({scope: {kind: "accepted", projectIds}, label: "Archive all Accepted tasks in selected projects?"})}><ArchiveIcon /></button></Tooltip.Trigger>
                <Tooltip.Portal><Tooltip.Content data-bb-plugin="kanban" side="bottom" sideOffset={6} collisionPadding={8} className="z-[1100] rounded border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md">Archive accepted</Tooltip.Content></Tooltip.Portal>
              </Tooltip.Root></Tooltip.Provider>}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">{column.description}</p>
          </div>)}
        </div>
        {!projects.length && <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{!visibleIds.size ? "Select projects to show their threads." : parentOnly && allVisibleCards.length ? "No parent threads in the selected projects." : "No threads in the selected projects."}</p>}
        {projects.map(({ project, folder }) => project && <section key={project.id} aria-label={`Project ${project.name}`} className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
          <div role="group" aria-label={`Project header for ${project.name}`} className={`grid items-center bg-muted/40 py-2.5 ${collapsedProjects.has(project.id) ? "" : "border-b border-border"}`} style={{gridTemplateColumns: `repeat(${shownColumns.length}, minmax(0, 1fr))`}}>
            <div className="col-span-3 flex min-w-0 items-center gap-2 pl-3">
              <button type="button" aria-label={`${collapsedProjects.has(project.id) ? "Expand" : "Collapse"} project ${project.name}`} aria-expanded={!collapsedProjects.has(project.id)} onClick={() => setCollapsedProjects((current) => {
                const next = new Set(current);
                if (next.has(project.id)) next.delete(project.id); else next.add(project.id);
                return next;
              })} className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span aria-hidden className={`text-xs text-muted-foreground transition-transform ${collapsedProjects.has(project.id) ? "-rotate-90" : ""}`}>▾</span>
                <h3 className="truncate text-sm font-semibold">{project.name}</h3>
              </button>
              <span className="rounded-full bg-background px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{visibleCards.filter((card) => card.projectId === project.id).length}</span>
              <button type="button" aria-label={`New thread in ${project.name}`} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => threadActions.openNewThread({ projectId: project.id, focusPrompt: true })}>+ New thread</button>
            </div>
            <div className="col-start-4 flex justify-end px-4">
              <AcceptAllButton label={`Accept all Done tasks in ${project.name}`} onClick={() => setAcceptAll({projectIds: [project.id], label: `Accept all Done tasks in ${project.name}?`})} />
            </div>
            <div className="flex items-center justify-end gap-2 px-3" style={{gridColumn: "5 / -1"}}>
              <ProjectArchiveMenu name={project.name}
                onAccepted={() => setArchive({scope: {kind: "accepted", projectIds: [project.id]}, label: `Archive Accepted tasks in ${project.name}?`})}
                onAll={() => setArchive({scope: {kind: "project", projectId: project.id}, label: `Archive all tasks in ${project.name}?`})} />
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><FolderMark folder={folder} />{folder.name}</span>
            </div>
          </div>
          {!collapsedProjects.has(project.id) && <ProjectCards project={project} cards={visibleCards.filter((card) => card.projectId === project.id)} allCards={allVisibleCards} showLinks={showLinks} showArchive={showArchive} />}
        </section>)}
      </div>}
  </div>;
}

export default definePluginApp((app) => {
  app.contentScripts.register({ id: "agent-picker-focus", mount: mountAgentPickerFocus });
  app.slots.experimental_threadHeaderAction({ id: "thread-actions", title: "Thread shortcuts", component: ThreadActions });
  app.composer.customize({ id: "kanban-acceptance", scopes: ["thread"], banners: [{ id: "acceptance", chrome: "bare", component: ThreadAcceptance }] });
  app.composer.customize({ id: "task-worktree-default", scopes: ["new-thread"], banners: [{ id: "worktree-default", chrome: "bare", component: NewThreadWorktree }] });
  app.composer.customize({ id: "save-draft", scopes: ["thread", "new-thread"], actions: [{ id: "save-draft", component: SaveDraftAction }] });
  app.slots.experimental_environmentProviderInputs({ environmentProviderId: taskWorktreeProvider, component: ActiveBranchInputs });
  app.slots.navPanel({ id: "board", title: "Kanban", icon: "Columns3", path: "board", component: Board });
});
