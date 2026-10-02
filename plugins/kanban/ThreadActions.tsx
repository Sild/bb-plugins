import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import * as Tooltip from "@radix-ui/react-tooltip";
import { experimental_useSidebarThreads, experimental_useSidebarThreadActions, useBbNavigate, useSdk, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";

const buttonClass = "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const paths = {
  archive: "M3 3h18v4H3z M5 7v13h14V7 M12 10v6m-3-3 3 3 3-3",
  pin: "m16 3 5 5-4 1-4 4-1 5-6-6 5-1 4-4z M6 18l-3 3",
  unread: "M3 5h18v14H3z m0 1 9 7 9-7",
  section: "M3 4h12v4H3z M3 12h7v4H3z M14 15h7m-3-3 3 3-3 3 M3 20h7",
  copy: "M9 9h12v12H9z M5 15H3V3h12v2",
  delete: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7m4-7v7",
};
function Icon({ name }: { name: keyof typeof paths }) {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

/** Decorate the installed host's menu container without changing its React-owned children. */
export function attachHeaderActions(anchor: HTMLElement) {
  let ancestor = anchor.parentElement;
  while (ancestor && ancestor !== document.body) {
    const menus = ancestor.querySelectorAll<HTMLElement>('[data-testid="thread-detail-header-actions-menu"]');
    if (menus.length === 1) {
      const menu = menus[0];
      const trigger = menu.querySelector<HTMLButtonElement>('button[aria-label="Thread actions"]');
      if (!trigger) return null;
      const container = document.createElement("span");
      container.dataset.kanbanThreadActions = "";
      container.style.display = "inline-flex";
      const display = trigger.style.display;
      menu.append(container);
      trigger.style.display = "none";
      return { container, dispose: () => { container.remove(); trigger.style.display = display; } };
    }
    if (menus.length > 1) return null;
    if (ancestor.hasAttribute("data-split-pane-id")) return null;
    ancestor = ancestor.parentElement;
  }
  return null;
}

export function ThreadActions(props: PluginThreadHeaderActionProps) {
  return <HeaderActions key={props.threadId} {...props} />;
}
function HeaderActions({ threadId }: PluginThreadHeaderActionProps) {
  const { threads } = experimental_useSidebarThreads();
  const available = threads.some((thread) => thread.id === threadId);
  const anchor = useRef<HTMLSpanElement>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!anchor.current || !available) { setTarget(null); return; }
    const attachment = attachHeaderActions(anchor.current);
    if (!attachment) return;
    setTarget(attachment.container);
    return attachment.dispose;
  }, [available]);
  return <><span ref={anchor} />{target ? createPortal(<ThreadActionRow threadId={threadId} />, target) : <ThreadActionRow threadId={threadId} />}</>;
}

function ActionDialog({ children, title, onClose }: { children: ReactNode; title: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return createPortal(<dialog ref={dialog} data-bb-plugin="kanban" aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }} className="fixed left-1/2 top-1/2 m-0 max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-4 text-foreground shadow-lg backdrop:bg-black/40">
    <h2 className="mb-3 text-sm font-semibold">{title}</h2>{children}
  </dialog>, document.body);
}

function ThreadActionRow({ threadId }: { threadId: string }) {
  const actions = experimental_useSidebarThreadActions();
  const { threads, sections } = experimental_useSidebarThreads();
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const row = useRef<HTMLSpanElement>(null);
  const [archiveChildren, setArchiveChildren] = useState<number | null>(null);
  const thread = threads.find((item) => item.id === threadId);
  const [editor, setEditor] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (!thread) return null;
  const run = async (operation: () => Promise<unknown>) => {
    setPending(true); setError(null); setCopied(false);
    try { await operation(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(false); }
  };
  const control = (name: keyof typeof paths, label: string, onClick: () => void, pressed?: boolean) => <Tooltip.Root>
    <Tooltip.Trigger asChild>
      <button type="button" aria-label={label} disabled={pending} aria-pressed={pressed} className={`${buttonClass} ${name === "archive" ? "border border-border text-foreground" : ""} ${name === "delete" ? "ml-2 hover:text-destructive" : ""}`} onClick={onClick}><Icon name={name} /></button>
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content data-bb-plugin="kanban" side="bottom" sideOffset={6} collisionPadding={8}
        className="z-[1100] rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md">
        {label}
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>;
  const closeEditor = () => setEditor(false);
  const archiveOnBoard = async (path = window.location.pathname) => {
    await sdk.threads.archive({ threadId });
    setArchiveChildren(null);
    if (window.location.pathname === path) navigate.toPluginPanel("board", { replace: true });
  };
  const archive = () => {
    const paneId = row.current?.closest("[data-split-pane-id]")?.getAttribute("data-split-pane-id");
    const board = Array.from(document.querySelectorAll("[data-kanban-board]")).find(element => element.getClientRects().length && element.closest("[data-split-pane-id]")?.getAttribute("data-split-pane-id") === paneId);
    if (!board) { actions.archive(threadId); return; }
    const path = window.location.pathname;
    void run(async () => {
      const summary = await sdk.threads.childSummary({ threadId });
      if (summary.nonDeletedChildCount) setArchiveChildren(summary.nonDeletedChildCount);
      else await archiveOnBoard(path);
    });
  };
  return <>
    <Tooltip.Provider delayDuration={150} skipDelayDuration={300}>
      <span ref={row} role="group" aria-label="Thread actions" className="inline-flex shrink-0 items-center gap-0.5" onPointerDown={(event) => event.stopPropagation()}>
        {control("archive", thread.isArchived ? "Unarchive" : "Archive", () => thread.isArchived ? void run(() => sdk.threads.unarchive({ threadId })) : archive())}
        {control("pin", thread.isPinned ? "Unpin" : "Pin", () => void run(() => actions.setPinned(threadId, !thread.isPinned)), thread.isPinned)}
        {control("unread", thread.isUnread ? "Mark read" : "Mark unread", () => void run(() => actions.setRead(threadId, thread.isUnread)))}
        {control("section", "Move to section", () => setEditor(true))}
        {control("copy", copied ? "Thread link copied" : "Copy thread link", () => void run(async () => { await navigator.clipboard.writeText(new URL(thread.href, window.location.href).href); setCopied(true); }))}
        {control("delete", "Delete", () => actions.requestDelete(threadId))}
        {copied && <span role="status" className="sr-only">Thread link copied</span>}
      </span>
    </Tooltip.Provider>
    {archiveChildren !== null && <ActionDialog title="Archive thread and children?" onClose={() => { if (!pending) setArchiveChildren(null); }}>
      <p className="mb-3 text-sm">Archive this thread and its {archiveChildren} child {archiveChildren === 1 ? "thread" : "threads"}? Running tasks will be stopped by BB.</p>
      <div className="flex justify-end gap-2">
        <button type="button" disabled={pending} className="rounded border border-border px-3 py-1 text-xs" onClick={() => setArchiveChildren(null)}>Cancel</button>
        <button type="button" disabled={pending} className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground" onClick={() => void run(() => archiveOnBoard())}>{pending ? "Archiving…" : "Archive all"}</button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </ActionDialog>}
    {editor && <ActionDialog title="Move to section" onClose={closeEditor}>
      <label className="text-xs">Section <select autoFocus aria-label="Move to section" disabled={pending} className="rounded border border-border bg-background px-2 py-1" value={thread.sectionId ?? ""} onChange={(event) => { const sectionId = event.target.value || null; void run(async () => { await sdk.threads.update({ threadId, sectionId }); setEditor(false); }); }}><option value="">No section</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select></label>
      <button type="button" className="mt-3 rounded border border-border px-3 py-1 text-xs" onClick={closeEditor}>Cancel</button>
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </ActionDialog>}
    {error && !editor && archiveChildren === null && <ActionDialog title="Action failed" onClose={() => setError(null)}><p role="alert" className="text-sm">{error}</p><button type="button" className="mt-3 rounded border border-border px-3 py-1 text-xs" onClick={() => setError(null)}>Close</button></ActionDialog>}
  </>;
}
