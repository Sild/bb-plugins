import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { Card, rpcContract } from "./server";

export function AcceptAllButton({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return <Tooltip.Provider delayDuration={150}><Tooltip.Root>
    <Tooltip.Trigger asChild><button type="button" disabled={disabled} aria-label={label} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" onClick={onClick}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 7 17l-5-5 M22 10l-7.5 7.5L13 16" /></svg></button></Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content data-bb-plugin="kanban" side="bottom" sideOffset={6} collisionPadding={8} className="z-[1100] rounded border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md">{label}</Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root></Tooltip.Provider>;
}

export function AcceptAllDialog({ projectIds, label, close, refresh }: { projectIds: string[] | null; label: string; close: () => void; refresh: () => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const dialog = useRef<HTMLDialogElement>(null);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  useEffect(() => {
    let disposed = false;
    rpc.call("board_done", { projectIds }).then(cards => { if (!disposed) setCards(cards); }, cause => { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { disposed = true; };
  }, [rpc, projectIds]);
  const accept = async () => {
    if (!cards?.length) return;
    setPending(true); setError(null);
    try {
      const result = await rpc.call("board_accept_all", { projectIds, revisions: cards.map(card => ({ threadId: card.id, expectedUpdatedAt: card.updatedAt })) });
      setResult(`${result.accepted} accepted. ${result.merging} merging. ${result.failed} could not be accepted.`);
      if (result.failed) setError(result.failures.map(f => `${cards.find(card => card.id === f.threadId)?.title ?? f.threadId}: ${f.reason}`).join("\n"));
      refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(false); }
  };
  return createPortal(<dialog ref={dialog} data-bb-plugin="kanban" aria-label="Accept Done tasks" onCancel={event => { if (pending) event.preventDefault(); else close(); }} className="fixed left-1/2 top-1/2 m-0 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-5 text-foreground shadow-lg backdrop:bg-black/40">
    <h2 className="text-base font-semibold">{label}</h2>
    <p className="my-3 text-sm text-muted-foreground">Accept all Done tasks in this selection, including tasks beyond the board display limit. Parent only and collapsed rows do not limit this action.</p>
    <p className="mb-3 text-xs text-muted-foreground">Acceptance runs the usual Git checks and locally merges managed task worktrees. Changed or busy tasks are skipped.</p>
    {!result && <>
      <p role="status" className="my-3 text-sm">{cards === null ? error ? "Could not load tasks. Close and try again." : "Loading Done tasks…" : `${cards.length} Done ${cards.length === 1 ? "task" : "tasks"} to accept.`}</p>
      {!!cards?.length && <ul aria-label="Done tasks to accept" className="mb-3 max-h-48 overflow-auto rounded border border-border p-2 text-sm">{cards.map(card => <li key={card.id} className="break-words py-1">{card.title}</li>)}</ul>}
    </>}
    {result && <p role="status" className="my-3 text-sm">{result}</p>}
    {error && <p role="alert" className="my-3 whitespace-pre-wrap text-sm text-destructive">{error}</p>}
    <div className="flex justify-end gap-2">
      <button type="button" disabled={pending} className="rounded border border-border px-3 py-2 text-sm" onClick={close}>{result ? "Close" : "Cancel"}</button>
      {!result && <button type="button" disabled={pending || !cards?.length} className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50" onClick={() => void accept()}>{pending ? "Accepting…" : "Accept all"}</button>}
    </div>
  </dialog>, document.body);
}
