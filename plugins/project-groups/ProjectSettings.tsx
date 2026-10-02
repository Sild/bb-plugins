import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { experimental_useSidebarThreads, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { GroupState, ProjectGroup, rpcContract } from "./server";
import { GroupMark, type Appearance } from "./IconPicker";

import { SectionEditor } from "./SectionEditor";
import { usePortalScopeProps } from "./lib/portal-scope";



function FolderSetting({ projectId }: { projectId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<GroupState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProjectGroup | "new" | null>(null);

  const load = useCallback(() => {
    rpc.call("groups_list").then(setState, (cause) => setError(String(cause)));
  }, [rpc]);
  useEffect(load, [load]);
  useRealtime("groups-changed", load);

  const run = async (operation: Promise<GroupState>) => {
    try {
      setState(await operation);
      setError(null);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  };
  const selectedId = state?.assignments[projectId] ?? "";
  const selected = state?.groups.find((group) => group.id === selectedId);
  const createdId = useRef<string | null>(null);
  const beginEdit = (group: ProjectGroup | "new") => { createdId.current = null; setEditing(group); };
  const save = async (name: string, appearance: Appearance): Promise<boolean> => {
    if (editing === "new") {
      if (!createdId.current) {
        const next = await rpc.call("groups_create", { name, ...appearance });
        createdId.current = next.createdId;
        setState(next);
      } else if (!await run(rpc.call("groups_update", { id: createdId.current, name, ...appearance }))) return false;
      if (!await run(rpc.call("groups_assign", { projectId, groupId: createdId.current }))) return false;
    } else if (editing) {
      if (!await run(rpc.call("groups_update", { id: editing.id, name, ...appearance }))) return false;
    }
    return true;
  };
  return <section className="rounded-xl border border-border bg-card p-4">
    <h2 className="text-sm font-semibold">Project folder</h2>
    <p className="mt-1 text-xs text-muted-foreground">Each project has one folder. Pinning keeps its folder assignment.</p>
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {selected && <GroupMark value={selected} className={selected.iconName ? "size-4" : ""} />}
      <select value={selectedId} aria-label="Project folder"
        className="min-w-44 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
        onChange={(event) => void run(rpc.call("groups_assign", {
          projectId, groupId: event.target.value || null,
        }))}>
        <option value="">Other projects</option>
        {state?.groups.map((group) =>
          <option key={group.id} value={group.id}>{group.sign || (group.iconName ? "◆" : "📁")} {group.name}</option>)}
      </select>
      <button type="button" className="rounded-md border border-border px-2 py-1.5 text-xs hover:bg-accent"
        onClick={() => beginEdit("new")}>New folder</button>
      {selected && <button type="button" className="rounded-md border border-border px-2 py-1.5 text-xs hover:bg-accent"
        onClick={() => beginEdit(selected)}>Edit folder</button>}
    </div>
    {editing && <SectionEditor group={editing} close={() => setEditing(null)} save={save}
      remove={editing === "new" ? undefined : () => run(rpc.call("groups_delete", { id: editing.id }))} />}
  </section>;
}

/** BB has no project-settings slot; mount a card into its current settings page. */
export function ProjectSettingsOverlay() {
  const { projects } = experimental_useSidebarThreads();
  const scope = usePortalScopeProps();
  const [target, setTarget] = useState<{ mount: HTMLDivElement; projectId: string } | null>(null);
  const routes = projects.filter((project) => !project.isPersonal)
    .map((project) => [project.id, project.settingsHref] as const);
  const routeKey = JSON.stringify(routes);

  useEffect(() => {
    let mount: HTMLDivElement | null = null;
    let frame = 0;
    const sync = () => {
      const projectId = routes.find(([, href]) =>
        new URL(href, window.location.origin).pathname === window.location.pathname)?.[0];
      const container = projectId
        ? document.querySelector<HTMLDivElement>("div.mx-auto.w-full.max-w-3xl.space-y-6.pb-10")
        : null;
      if (!projectId || !container) {
        mount?.remove();
        mount = null;
        setTarget(null);
        return;
      }
      if (mount?.parentElement === container && mount.dataset.projectGroupsSettings === projectId) return;
      mount?.remove();
      mount = document.createElement("div");
      mount.dataset.projectGroupsSettings = projectId;
      container.insertBefore(mount, container.lastElementChild);
      setTarget({ mount, projectId });
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; sync(); });
    };
    sync();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("popstate", schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener("popstate", schedule);
      if (frame) cancelAnimationFrame(frame);
      mount?.remove();
    };
  }, [routeKey]);

  return target ? createPortal(<div {...scope}><FolderSetting key={target.projectId} projectId={target.projectId} /></div>, target.mount) : null;
}
