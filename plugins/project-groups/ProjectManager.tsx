import { useCallback, useEffect, useState } from "react";
import { useRealtime, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import type { GroupState, rpcContract } from "./server";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./components/ui/dialog";

type Project = { id: string; name: string };
type Entry = { key: number; name: string; path: string; error?: string };
const control = "rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-50";

export function ProjectManager({ state, close, changed }: {
  state: GroupState; close: () => void; changed: (state: GroupState) => void;
}) {
  const sdk = useSdk();
  const rpc = useRpc<typeof rpcContract>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [hosts, setHosts] = useState<{ id: string; name: string }[]>([]);
  const [hostId, setHostId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [folder, setFolder] = useState("");
  const [adding, setAdding] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([{ key: 0, name: "", path: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    const next = (await sdk.projects.list()).filter(project => project.kind !== "personal");
    setProjects(next);
    setSelected(current => new Set([...current].filter(id => next.some(project => project.id === id))));
    setLoaded(true);
  }, [sdk]);
  useEffect(() => { void load().catch(cause => setError(String(cause))); }, [load]);
  useRealtime("groups-changed", () => { void load().catch(cause => setError(String(cause))); });
  useEffect(() => {
    sdk.hosts.list().then(next => {
      const connected = next.filter(host => host.status === "connected" && host.lifecycle.phase === "active");
      setHosts(connected);
      if (connected.length === 1) setHostId(connected[0].id);
    }, cause => setError(String(cause)));
  }, [sdk]);
  const visible = projects.filter(project => project.name.toLowerCase().includes(search.toLowerCase()));
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const update = (change: { groupId?: string | null; pinned?: boolean }) => void run(async () => {
    changed(await rpc.call("groups_bulk_update", { projectIds: [...selected], ...change }));
    setNotice(`Updated ${selected.size} projects.`);
  });
  const add = () => void run(async () => {
    const result = await rpc.call("projects_add", { hostId, groupId: folder || null,
      projects: entries.map(({ name, path }) => ({ name, path })) });
    const failed = result.results.flatMap((result, index) => result.error ? [{ ...entries[index], error: result.error }] : []);
    setEntries(failed.length ? failed : [{ key: 0, name: "", path: "" }]);
    setNotice(`Added ${result.results.length - failed.length} projects${failed.length ? `; ${failed.length} failed. Fix the rows and retry.` : "."}`);
    // Keep the result visible even if refreshing fails after successful creation.
    changed(await rpc.call("groups_list"));
    await load();
  });
  const toggle = (id: string) => setSelected(current => {
    const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const folderSelect = <select aria-label={adding ? "Folder for new projects" : "Destination folder"} value={folder} disabled={busy} className={control} onChange={event => setFolder(event.target.value)}>
    <option value="">Other projects</option>
    {state.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
  </select>;
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}>
    <DialogContent hideCloseButton={busy} className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
      <DialogTitle>Manage projects</DialogTitle>
      <DialogDescription>Add several projects or select projects to move into one folder. Pinned projects also stay visible in their folder.</DialogDescription>
      <div className="flex gap-2">
        <button className={control} disabled={busy} aria-pressed={!adding} onClick={() => setAdding(false)}>Organize projects</button>
        <button className={control} disabled={busy} aria-pressed={adding} onClick={() => setAdding(true)}>Add projects</button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {adding ? <form onSubmit={event => { event.preventDefault(); add(); }} className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <select aria-label="Project host" required disabled={busy} value={hostId} className={control} onChange={event => setHostId(event.target.value)}>
            <option value="">Select host</option>{hosts.map(host => <option key={host.id} value={host.id}>{host.name}</option>)}
          </select>{folderSelect}
        </div>
        <p className="text-xs text-muted-foreground">Use existing directories on the selected host. Existing projects at the same host and path are reused and moved to the chosen folder.</p>
        {!hosts.length && <p className="text-sm text-muted-foreground">A connected host is required to add projects.</p>}
        {entries.map((entry, index) => <div key={entry.key} className="space-y-1">
          <div className="flex flex-wrap gap-2">
            <input aria-label={`Project name ${index + 1}`} placeholder="Project name" required maxLength={60} disabled={busy} value={entry.name} className={`${control} min-w-0 flex-1`} onChange={event => setEntries(current => current.map(row => row.key === entry.key ? { ...row, name: event.target.value } : row))} />
            <input aria-label={`Project path ${index + 1}`} placeholder="/path/to/project" required disabled={busy} value={entry.path} className={`${control} min-w-0 flex-1`} onChange={event => setEntries(current => current.map(row => row.key === entry.key ? { ...row, path: event.target.value } : row))} />
            <button type="button" className={control} disabled={busy || entries.length === 1} aria-label={`Remove project row ${index + 1}`} onClick={() => setEntries(current => current.filter(row => row.key !== entry.key))}>×</button>
          </div>
          {entry.error && <p role="alert" className="text-xs text-destructive">{entry.name}: {entry.error}</p>}
        </div>)}
        <div className="flex justify-between gap-2">
          <button type="button" className={control} disabled={busy || entries.length >= 100} onClick={() => setEntries(current => [...current, { key: Math.max(...current.map(row => row.key)) + 1, name: "", path: "" }])}>+ Add row</button>
          <button type="submit" className={control} disabled={busy || !hostId || entries.some(row => !row.name.trim() || !row.path.trim())}>{busy ? "Adding…" : `Add ${entries.length} projects`}</button>
        </div>
      </form> : <>
        <input type="search" aria-label="Search projects" placeholder="Search projects" value={search} className={control} onChange={event => setSearch(event.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <button className={control} disabled={busy || !visible.length} onClick={() => setSelected(current => new Set([...current, ...visible.map(project => project.id)]))}>Select all shown</button>
          <button className={control} disabled={busy || !selected.size} onClick={() => setSelected(new Set())}>Clear selection</button>
          <span className="text-sm">{selected.size} selected</span>
        </div>
        {!loaded && <p className="text-sm">Loading projects…</p>}
        {loaded && !visible.length && <p className="text-sm">No projects found.</p>}
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {visible.map(project => <label key={project.id} className="flex items-center gap-2 rounded p-2 text-sm hover:bg-accent">
            <input type="checkbox" checked={selected.has(project.id)} disabled={busy} onChange={() => toggle(project.id)} />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            <span className="text-xs text-muted-foreground">{state.groups.find(group => group.id === state.assignments[project.id])?.name ?? "Other projects"}{state.pinnedProjectIds.includes(project.id) ? " · Pinned" : ""}</span>
          </label>)}
        </div>
        <div className="flex flex-wrap gap-2">{folderSelect}
          <button className={control} disabled={busy || !selected.size} onClick={() => update({ groupId: folder || null })}>Move to folder</button>
          <button className={control} disabled={busy || !selected.size} onClick={() => update({ pinned: true })}>Pin selected</button>
          <button className={control} disabled={busy || !selected.size} onClick={() => update({ pinned: false })}>Unpin selected</button>
        </div>
      </>}
      <button className={`${control} ml-auto`} disabled={busy} onClick={close}>Close</button>
    </DialogContent>
  </Dialog>;
}
