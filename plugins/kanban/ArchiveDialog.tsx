import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import type { ArchiveScope } from "./archive";

export function ArchiveDialog({scope, label, close, refresh}: {scope: ArchiveScope; label: string; close: () => void; refresh: () => void}) {
  const rpc = useRpc<typeof rpcContract>();
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  const archive = async () => {
    setPending(true); setError(null);
    try {
      const result = await rpc.call("board_archive", scope);
      refresh();
      if (!result.failed) { close(); return; }
      setResult(`${result.archived} archived. ${result.failed} could not be archived.`);
      setError(result.failures.map(f => `${f.threadId}: ${f.reason}`).join("\n"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(false); }
  };
  return createPortal(<dialog ref={dialog} data-bb-plugin="kanban" aria-label="Archive tasks" onCancel={event => { if (pending) event.preventDefault(); else close(); }} className="fixed left-1/2 top-1/2 m-0 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-5 text-foreground shadow-lg backdrop:bg-black/40">
    <h2 className="text-base font-semibold">{label}</h2>
    <p className="my-3 text-sm text-muted-foreground">{scope.kind === "accepted" ? "Archive all currently Accepted tasks in this selection, including tasks beyond the board display limit." : "Archive every unarchived task in this project, including hidden tasks and tasks beyond the board display limit. Running tasks will be stopped by BB."}</p>
    <p className="mb-3 text-xs text-muted-foreground">Tasks with dependent tasks outside this selection will be skipped. Archiving follows BB’s normal environment cleanup policy.</p>
    {result && <p role="status" className="my-3 text-sm">{result}</p>}
    {error && <p role="alert" className="my-3 whitespace-pre-wrap text-sm text-destructive">{error}</p>}
    <div className="flex justify-end gap-2">
      <button type="button" disabled={pending} className="rounded border border-border px-3 py-2 text-sm" onClick={close}>{result ? "Close" : "Cancel"}</button>
      {!result && <button type="button" disabled={pending} className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50" onClick={() => void archive()}>{pending ? "Archiving…" : "Archive all"}</button>}
    </div>
  </dialog>, document.body);
}
