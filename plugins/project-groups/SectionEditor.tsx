import { useState } from "react";
import type { ProjectGroup } from "./server";
import { IconPicker, type Appearance } from "./IconPicker";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./components/ui/dialog";

export function SectionEditor({ group, close, save, remove, confirmDelete = false }: {
  group: ProjectGroup | "new";
  confirmDelete?: boolean;
  close: () => void;
  save: (name: string, appearance: Appearance) => Promise<boolean>;
  remove?: () => Promise<boolean>;
}) {
  const [name, setName] = useState(group === "new" ? "" : group.name);
  const [appearance, setAppearance] = useState<Appearance>(group === "new"
    ? { sign: "", iconName: null, iconColor: "#38c878" } : group);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(confirmDelete);
  const [error, setError] = useState("");
  const submit = async (action: () => Promise<boolean>) => {
    setBusy(true);
    setError("");
    try { if (await action()) close(); else setError("Could not save the change. Please try again."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) close(); }}>
    <DialogContent className="sm:max-w-md">
      <DialogTitle>{deleting ? "Delete section?" : group === "new" ? "New section" : "Edit section"}</DialogTitle>
      <DialogDescription>{deleting
        ? "Projects in this section will move to Other projects. Your projects and threads will be kept, and pinned projects stay pinned."
        : "Give this folder a name and an icon to find your projects quickly."}</DialogDescription>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {deleting ? <div className="flex justify-end gap-2 pt-2">
        <button type="button" disabled={busy} className="rounded-md border border-border px-4 py-2 text-sm" onClick={() => setDeleting(false)}>Cancel</button>
        <button type="button" disabled={busy} className="rounded-md bg-destructive px-4 py-2 text-sm text-destructive-foreground" onClick={() => remove && void submit(remove)}>Delete section</button>
      </div> : <form onSubmit={(event) => { event.preventDefault(); if (name.trim()) void submit(() => save(name.trim(), appearance)); }}>
        <label htmlFor="section-name" className="mb-2 block text-sm font-medium">Section name</label>
        <div className="flex items-center gap-3">
          <IconPicker value={appearance} onChange={setAppearance} />
          <input id="section-name" autoFocus value={name} maxLength={60} required disabled={busy}
            onChange={(event) => setName(event.target.value)} placeholder="e.g. Work"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </div>
        <div className="mt-6 flex items-center gap-2">
          {remove && <button type="button" disabled={busy} onClick={() => setDeleting(true)} className="rounded-md px-2 py-2 text-sm text-destructive hover:bg-accent">Delete section…</button>}
          <button type="button" disabled={busy} onClick={close} className="ml-auto rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
          <button type="submit" disabled={busy || !name.trim()} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>}
    </DialogContent>
  </Dialog>;
}
