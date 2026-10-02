import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import {
  definePluginApp, experimental_Icon as Icon, experimental_useSidebarThreadActions,
  experimental_useSidebarThreadSplit, experimental_useSidebarThreads, ThreadTitle,
  useRealtime, useRpc, useSidebarThreadDraft, useSidebarThreadRowStatus, useSidebarThreadShortcut,
  type PluginSidebarProject, type PluginSidebarThread, type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import type { GroupState, ProjectGroup, rpcContract } from "./server";
import { GroupMark, type Appearance } from "./IconPicker";
import { ThreadCounts, useThreadCounts, sumProjectCounts, type Counts } from "./ThreadCounts";
import { SectionEditor } from "./SectionEditor";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { usePortalScopeProps } from "./lib/portal-scope";
import { ProjectSettingsOverlay } from "./ProjectSettings";
import { ProjectManager } from "./ProjectManager";
import { NewThreadAgentDefaults, NewThreadNavigationDefaults } from "./NewThreadDefaults";
import "./sidebar.css";

const button = "rounded p-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground";


const indicatorIcons: Record<string, string> = {
  "unread-error": "CircleX", "unread-success": "CircleCheck", "waiting-for-input": "CircleQuestion",
  "working-draft": "Edit", "draft": "Edit", "runtime": "Loading",
  "queued-waiting": "TimeSchedule", "queued-failed": "AlertCircle", "background-agent": "Bot",
  "background-command": "Terminal", "plan-mode": "ListTodo", "goal": "Target",
  "workflow": "Workflow",
};

function ThreadRow({ thread, active, onNavigate, standalone = false }: {
  thread: PluginSidebarThread; active: boolean; onNavigate: () => void; standalone?: boolean;
}) {
  const actions = experimental_useSidebarThreadActions();
  const split = experimental_useSidebarThreadSplit(thread.id);
  const draft = useSidebarThreadDraft(thread.id);
  const rowStatus = useSidebarThreadRowStatus(thread.id);
  const shortcut = useSidebarThreadShortcut(thread.id);
  const urgent = thread.indicator === "waiting-for-input" || thread.indicator === "unread-error";
  const statusIcon = (urgent ? indicatorIcons[thread.indicator] : rowStatus?.icon ?? indicatorIcons[thread.indicator]) ??
    (draft.hasUnsubmittedDraft ? "Edit" : ["active", "starting", "stopping"].includes(thread.status) ? "Loading" : null);
  const statusLabel = (urgent ? thread.indicatorLabel : rowStatus?.label ?? thread.indicatorLabel) ??
    (draft.hasUnsubmittedDraft ? "Unsubmitted draft" : statusIcon === "Loading" ? "Thread working" : undefined);
  return (
    <div className={`pg-thread pg-row group relative flex min-w-0 items-center gap-1 ${standalone ? "mx-2" : "ml-7 mr-1"}`}>
      <a
        href={thread.href}
        data-sidebar-thread-shortcut-target=""
        data-sidebar-thread-id={thread.id}
        {...split.splitProps}
        aria-current={active ? "page" : undefined}
        title={thread.displayTitle}
        className={`pg-thread-link min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-sm hover:bg-accent ${active ? "bg-accent font-medium" : ""}`}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault();
          actions.open(thread.id);
          onNavigate();
        }}
      >
        {statusIcon && <Icon name={statusIcon} className={`mr-1 inline size-3.5 text-muted-foreground ${statusIcon === "Loading" ? "animate-spin" : ""}`}
          aria-label={statusLabel} />}
        <ThreadTitle threadId={thread.id} />
      </a>
      {shortcut && <span className="rounded border border-border px-1 text-[10px] text-muted-foreground">{shortcut.label}</span>}
      <button type="button" className={`${button} pg-secondary pg-archive`}
        title="Archive thread" aria-label={`Archive ${thread.displayTitle}`}
        onClick={() => actions.archive(thread.id)}>
        <Icon name="Archive" className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

function ProjectRow({ project, threads, pinned, activeProjectId, activeThreadId, pin, onNavigate, counts }: {
  project: PluginSidebarProject; threads: readonly PluginSidebarThread[]; pinned: boolean; counts?: Counts;
  activeProjectId: string | null; activeThreadId: string | null;
  pin: (projectId: string, pinned: boolean) => void; onNavigate: () => void;
}) {
  const [open, setOpen] = useState(project.id === activeProjectId);
  const childrenId = useId();
  const actions = experimental_useSidebarThreadActions();
  const scope = usePortalScopeProps();
  useEffect(() => { if (project.id === activeProjectId) setOpen(true); }, [project.id, activeProjectId]);
  const visible = threads.filter((thread) => thread.projectId === project.id && !thread.isHidden && !thread.isArchived);
  visible.sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.updatedAt - a.updatedAt);
  return (
    <div>
      <div className="pg-row group flex min-w-0 items-center gap-0.5 px-1">
        <button type="button" className={button} aria-expanded={open} aria-controls={childrenId} aria-label={`${open ? "Collapse" : "Expand"} ${project.name}`}
          onClick={() => setOpen(!open)}>{open ? "▾" : "▸"}</button>
        <a href={project.href} aria-current={project.id === activeProjectId && !activeThreadId ? "page" : undefined} title={project.name} className={`flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1.5 text-sm font-medium hover:bg-accent ${project.id === activeProjectId && !activeThreadId ? "bg-accent" : ""}`}
          onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return; onNavigate(); }}>
          <span className="min-w-0 flex-1 truncate">{project.name}</span>
          {pinned && <Icon name="Star" className="size-3 shrink-0 fill-current text-muted-foreground" aria-label="Pinned" />}
          <ThreadCounts counts={counts} compact />
        </a>
        <button type="button" className={`${button} flex size-7 shrink-0 items-center justify-center text-base`}
          title={`New thread in ${project.name}`} aria-label={`New thread in ${project.name}`}
          onClick={() => { actions.openNewThread({ projectId: project.id, focusPrompt: true }); onNavigate(); }}>+</button>
        <Menu.Root><Menu.Trigger asChild>
          <button type="button" className="pg-secondary rounded px-2 py-1 text-muted-foreground hover:bg-accent" aria-label={`Project options for ${project.name}`}>⋯</button>
        </Menu.Trigger><Menu.Portal><Menu.Content {...scope} align="end" sideOffset={4} className="z-[1000] min-w-44 rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg">
          {!project.isPersonal && <Menu.Item className="cursor-pointer rounded px-3 py-2 outline-none focus:bg-accent" onSelect={() => pin(project.id, !pinned)}>{pinned ? "Unpin project" : "Pin project"}</Menu.Item>}
          <Menu.Item asChild className="block cursor-pointer rounded px-3 py-2 outline-none focus:bg-accent"><a href={project.settingsHref}>Project settings</a></Menu.Item>
        </Menu.Content></Menu.Portal></Menu.Root>
      </div>
      <div id={childrenId} hidden={!open}>
        {open && visible.map((thread) => <ThreadRow key={thread.id} thread={thread} active={thread.id === activeThreadId} onNavigate={onNavigate} />)}
        {open && visible.length === 0 && <p className="ml-8 py-1 text-xs text-muted-foreground">No active threads</p>}
      </div>
    </div>
  );
}

function GroupSection({ group, first, last, edit, remove, move, children, counts }: {
  counts: Counts; group: ProjectGroup; first: boolean; last: boolean;
  edit: (group: ProjectGroup) => void; remove: (id: string) => void;
  move: (id: string, direction: "up" | "down") => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const childrenId = useId();
  const scope = usePortalScopeProps();
  return (
    <section className="mx-2 mt-3">
    <div className="pg-row flex items-center gap-1 px-1">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded py-1.5 text-left text-xs font-semibold text-muted-foreground hover:text-foreground"
        aria-expanded={open} aria-controls={childrenId} onClick={() => setOpen(!open)}>
        <span className="w-3 text-center text-xs" aria-hidden>{open ? "▾" : "▸"}</span>
        <GroupMark value={group} className="size-3.5 shrink-0" />
        <span title={group.name} className="min-w-0 flex-1 truncate">{group.name}</span>
        {!open && <ThreadCounts counts={counts} compact />}
      </button>
      <Menu.Root><Menu.Trigger asChild><button type="button" className="pg-secondary rounded-md px-2 py-1 text-muted-foreground hover:bg-accent" aria-label={`Folder options for ${group.name}`}>⋯</button></Menu.Trigger>
        <Menu.Portal><Menu.Content {...scope} align="end" sideOffset={4} className="z-[1000] min-w-44 rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg">
          <Menu.Item className="cursor-pointer rounded px-3 py-2 outline-none focus:bg-accent" onSelect={() => edit(group)}>Edit folder</Menu.Item>
          <Menu.Item disabled={first} className="cursor-pointer rounded px-3 py-2 outline-none focus:bg-accent data-[disabled]:opacity-40" onSelect={() => move(group.id, "up")}>Move up</Menu.Item>
          <Menu.Item disabled={last} className="cursor-pointer rounded px-3 py-2 outline-none focus:bg-accent data-[disabled]:opacity-40" onSelect={() => move(group.id, "down")}>Move down</Menu.Item>
          <Menu.Separator className="my-1 h-px bg-border" />
          <Menu.Item className="cursor-pointer rounded px-3 py-2 text-destructive outline-none focus:bg-accent" onSelect={() => remove(group.id)}>Delete folder…</Menu.Item>
        </Menu.Content></Menu.Portal>
      </Menu.Root>
    </div>
    <div id={childrenId} hidden={!open} className="ml-2">{children}</div>
    </section>
  );
}

function ProjectGroupsList(props: PluginThreadListProps) {
  const rpc = useRpc<typeof rpcContract>();
  const sidebar = experimental_useSidebarThreads();
  const {counts, error: countError} = useThreadCounts(sidebar.threads);
  const [state, setState] = useState<GroupState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState<ProjectGroup | "new" | null>(null);

  const load = useCallback(() => { rpc.call("groups_list").then(setState, (cause) => setError(String(cause))); }, [rpc]);
  useEffect(load, [load]);
  useRealtime("groups-changed", load);
  const run = useCallback(async (operation: Promise<GroupState>) => {
    try {
      const next = await operation;
      setState(next);
      setError(null);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  }, []);
  const beginEdit = (group: ProjectGroup | "new") => { setConfirmDelete(false); setEditing(group); };
  const save = async (name: string, appearance: Appearance) => editing === "new"
    ? run(rpc.call("groups_create", { name, ...appearance }))
    : editing ? run(rpc.call("groups_update", { id: editing.id, name, ...appearance })) : false;
  const groups = state?.groups ?? [];
  const projects = sidebar.projects.filter((project) => !project.isPersonal);
  const pinned = new Set(state?.pinnedProjectIds ?? []);
  const pin = (projectId: string, nextPinned: boolean) =>
    void run(rpc.call("groups_pin_project", { projectId, pinned: nextPinned }));
  const projectRows = (groupId: string | null) => projects
    .filter((project) => (groups.some(group => group.id === state?.assignments[project.id]) ? state?.assignments[project.id] : null) === groupId)
    .map((project) => <ProjectRow key={project.id} project={project} counts={counts[project.id]} threads={sidebar.threads}
      pinned={pinned.has(project.id)} activeProjectId={props.activeProjectId} activeThreadId={props.activeThreadId}
      onNavigate={props.onNavigate} pin={pin} />);
  const personal = sidebar.projects.find((project) => project.isPersonal);
  const ungroupedRows = projectRows(null);
  const personalThreads = sidebar.threads.filter(thread => thread.projectId === personal?.id && !thread.isHidden && !thread.isArchived)
    .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.updatedAt - a.updatedAt);
  return (
    <div className="pg-sidebar h-full overflow-y-auto pb-4">
      <div className="flex items-center justify-between mx-3 mt-4 mb-1 text-xs font-medium text-muted-foreground">
        <span>Projects</span><button type="button" className={button} onClick={() => setManaging(true)}>Manage projects</button><button type="button" className={button} onClick={() => beginEdit("new")}>+ Folder</button>
      </div>
      {countError && <p className="px-3 pt-2 text-xs text-muted-foreground" role="status">Thread counts unavailable. Retrying…</p>}
      {error && <p role="alert" className="px-3 py-2 text-xs text-destructive">{error}</p>}
      {managing && state && <ProjectManager state={state} close={() => setManaging(false)} changed={setState} />}
      {editing && <SectionEditor confirmDelete={confirmDelete} group={editing} close={() => setEditing(null)} save={save}
        remove={editing === "new" ? undefined : () => run(rpc.call("groups_delete", { id: editing.id }))} />}
      {sidebar.status === "loading" || !state ? <p className="px-3 py-3 text-xs text-muted-foreground">Loading projects…</p> : (
        <>
          {state.pinnedProjectIds.length > 0 && <section>
            <h2 className="mx-3 mt-4 mb-1 text-xs font-medium text-muted-foreground">★ Pinned</h2>
            {state.pinnedProjectIds.map((id) => projects.find((project) => project.id === id))
              .filter((project): project is PluginSidebarProject => project !== undefined)
              .map((project) => <ProjectRow key={project.id} project={project} counts={counts[project.id]} threads={sidebar.threads}
                pinned activeProjectId={props.activeProjectId} activeThreadId={props.activeThreadId}
                onNavigate={props.onNavigate} pin={pin} />)}
          </section>}
          {groups.map((group, index) => (
            <GroupSection key={group.id} counts={sumProjectCounts(projects.filter(project => state.assignments[project.id] === group.id).map(project => project.id), counts)} group={group} first={index === 0} last={index === groups.length - 1}
                edit={beginEdit} move={(id, direction) => void run(rpc.call("groups_move", { id, direction }))}
                remove={() => { setConfirmDelete(true); setEditing(group); }}>
              {projectRows(group.id)}
            </GroupSection>
          ))}
          {ungroupedRows.length > 0 && <section className="mx-2 mt-3">
            <h2 className="mx-2 mb-1 text-xs font-medium text-muted-foreground">Other projects</h2>
            {ungroupedRows}
          </section>}
          {personalThreads.length > 0 && <section>
            <h2 className="mx-3 mt-4 border-t border-border pt-3 pb-1 text-xs font-medium text-muted-foreground">Other threads</h2>
            {personalThreads.map(thread => <ThreadRow standalone key={thread.id} thread={thread} active={thread.id === props.activeThreadId} onNavigate={props.onNavigate} />)}
          </section>}
        </>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.composer.customize({ id: "new-thread-agent-defaults", scopes: ["new-thread"], banners: [{ id: "agent-default", chrome: "bare", component: NewThreadAgentDefaults }] });
  app.slots.experimental_appOverlay({ id: "project-folder-settings", component: ProjectSettingsOverlay });
  app.slots.experimental_appOverlay({ id: "new-thread-navigation-defaults", component: NewThreadNavigationDefaults });
  app.slots.experimental_threadList({
    id: "project-groups",
    title: "Project groups",
    component: ProjectGroupsList,
  });
});
