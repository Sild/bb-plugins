import { useEffect, useRef, useState } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { BoardProject, ProjectFolder } from "./board";

export function FolderMark({ folder }: { folder: ProjectFolder }) {
  if (folder.iconName) return <Icon name={folder.iconName} className="size-4 shrink-0" style={{ color: folder.iconColor ?? undefined }} aria-hidden />;
  return <span aria-hidden className="shrink-0">{folder.sign || "▸"}</span>;
}

function SelectionCheckbox({ checked, partial = false, label, onChange }: {
  checked: boolean; partial?: boolean; label: string; onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = partial; }, [partial]);
  return <input ref={ref} type="checkbox" checked={checked} aria-label={label} onChange={onChange} className="size-4 shrink-0 accent-primary" />;
}

export function ProjectFilter({ projects, folders, selectedIds, onChange, onOpen }: {
  projects: BoardProject[]; folders: ProjectFolder[]; selectedIds: string[] | null;
  onChange: (ids: string[] | null) => void; onOpen: () => void;
}) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = new Set(selectedIds ?? projects.map((project) => project.id));
  const selectedCount = projects.filter((project) => selected.has(project.id)).length;
  const search = query.trim().toLocaleLowerCase();
  const matches = folders.map((folder) => ({
    folder,
    projects: folder.projectIds.map((id) => projects.find((project) => project.id === id))
      .filter((project): project is BoardProject => !!project)
      .filter((project) => !search || folder.name.toLocaleLowerCase().includes(search) || project.name.toLocaleLowerCase().includes(search)),
  })).filter((group) => group.projects.length);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !disclosure.current?.contains(event.target) && disclosure.current) disclosure.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function toggle(ids: string[]) {
    const next = new Set(selected);
    if (ids.every((id) => selected.has(id))) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    const currentIds = projects.filter((project) => next.has(project.id)).map((project) => project.id);
    onChange(currentIds.length === projects.length ? null : currentIds);
  }

  return <details ref={disclosure} className="relative" onToggle={(event) => {
    const nextOpen = event.currentTarget.open;
    setOpen(nextOpen);
    if (nextOpen) onOpen();
  }} onKeyDown={(event) => {
    if (event.key === "Escape" && disclosure.current) {
      disclosure.current.open = false;
      disclosure.current.querySelector("summary")?.focus();
    }
  }}>
    <summary className="cursor-pointer list-none rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-muted" aria-label="Filter by projects">
      {selectedIds === null ? "All projects" : `${selectedCount} project${selectedCount === 1 ? "" : "s"}`} <span aria-hidden className="ml-2 text-muted-foreground">▾</span>
    </summary>
    <div className="absolute left-0 top-full z-30 mt-2 w-80 max-w-[calc(100vw-3rem)] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-xl" aria-label="Project filter">
      <input type="search" aria-label="Search projects or folders" placeholder="Search projects or folders…" value={query} onChange={(event) => setQuery(event.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
      <div className="my-2 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{selectedCount} of {projects.length} selected</span>
        <div className="flex gap-3">
          <button type="button" className="hover:underline" onClick={() => onChange(null)}>Select all</button>
          <button type="button" className="hover:underline" onClick={() => onChange([])}>Clear</button>
        </div>
      </div>
      <div className="max-h-80 space-y-3 overflow-y-auto">
        {matches.map(({ folder, projects: entries }) => {
          const count = folder.projectIds.filter((id) => selected.has(id)).length;
          return <div key={folder.id} role="group" aria-label={folder.name}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-2 text-sm font-medium hover:bg-accent">
              <SelectionCheckbox checked={count === folder.projectIds.length} partial={count > 0 && count < folder.projectIds.length} label={`Select folder ${folder.name}`} onChange={() => toggle(folder.projectIds)} />
              <FolderMark folder={folder} /><span>{folder.name}</span>
            </label>
            {entries.map((project) => <label key={project.id} className="ml-5 flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent">
              <SelectionCheckbox checked={selected.has(project.id)} label={`Show project ${project.name}`} onChange={() => toggle([project.id])} />
              <span>{project.name}</span>
            </label>)}
          </div>;
        })}
        {!matches.length && <p className="py-4 text-center text-sm text-muted-foreground">No matching projects or folders.</p>}
      </div>
    </div>
  </details>;
}
