import { useCallback, useEffect, useRef, useState } from "react";
import { useComposerView, useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { Card, rpcContract } from "./server";
import { columns } from "./board";

export function ThreadAcceptance() {
  const view = useComposerView();
  const threadId = view.scope.kind === "thread" ? view.scope.threadId : null;
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [pending, setPending] = useState(false);
  const [committing, setCommitting] = useState(false);
  const request = useRef(0);
  const scope = useRef(threadId);
  scope.current = threadId;
  const refresh = useCallback(async () => {
    if (!threadId || scope.current !== threadId) return;
    const sequence = ++request.current;
    try {
      const next = await rpc.call("board_thread", { threadId });
      if (sequence === request.current) { setCard(next); setError(null); if (next.column !== "done") setReviewRequired(false); }
    } catch (cause) {
      if (sequence === request.current) { setCard(null); setError(cause instanceof Error ? cause.message : String(cause)); }
    }
  }, [rpc, threadId]);
  useEffect(() => {
    scope.current = threadId;
    setCard(null); setPending(false); setCommitting(false); setError(null); setReviewRequired(false);
    void refresh();
    return () => { request.current++; scope.current = null; };
  }, [refresh, view.run.isRunning, view.run.isSubmitting, connection]);
  useRealtime("board-changed", refresh);
  if (!threadId) return null;
  if (!card && error) return <div role="alert" className="text-xs text-destructive">{error} <button type="button" onClick={() => void refresh()}>Retry review status</button></div>;
  if (card?.id !== threadId) return null;
  const column = columns.find((item) => item.id === card.column)!;
  const canAccept = card.column === "done" && !view.run.isRunning && !view.run.isSubmitting;
  return <div className="my-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-foreground">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div role="status" aria-label="Kanban status" className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Kanban</span>
        <span className="inline-flex items-center gap-1.5 font-medium">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />{card.merging ? "Merging..." : column.label}
        </span>
        <span className="text-muted-foreground">{card.merging ? "Landing changes and removing the task worktree" : column.description}</span>
      </div>
    {canAccept && <div className="ml-auto flex items-center gap-2">
      <button type="button" disabled={pending || !card.hasPreparedCommit} className="min-h-8 shrink-0 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50" onClick={async () => {
        setPending(true); setCommitting(true);
        try {
          await rpc.call("board_commit", { threadId, expectedUpdatedAt: card.updatedAt });
          if (scope.current === threadId) { setReviewRequired(false); await refresh(); }
        } catch (cause) {
          if (scope.current === threadId) setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          if (scope.current === threadId) { setPending(false); setCommitting(false); }
        }
      }}>{committing ? "Committing…" : "Commit"}</button>
      <button type="button" disabled={pending} className="min-h-8 shrink-0 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50" onClick={async () => {
      setPending(true);
      try {
        const next = await rpc.call("board_accept", { threadId, expectedUpdatedAt: card.updatedAt, ...(reviewRequired ? { acknowledgeChanges: true } : {}) });
        if (scope.current === threadId) {
          if (next.reviewRequired) { setCard(next); setReviewRequired(true); setError(null); }
          else { setReviewRequired(false); await refresh(); }
        }
      } catch (cause) {
        if (scope.current === threadId) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (scope.current === threadId) setPending(false);
      }
    }}>{pending && !committing ? "Accepting…" : reviewRequired ? "Accept anyway" : "Accept"}</button></div>}
    </div>
    {card.mergeError && <div role="alert" className="mt-2 text-xs text-destructive">{card.mergeError} <button type="button" disabled={pending || view.run.isRunning || view.run.isSubmitting} className="underline" onClick={async () => {
      setPending(true);
      try { await rpc.call("board_retry_merge", { threadId }); if (scope.current === threadId) await refresh(); }
      catch (cause) { if (scope.current === threadId) setError(cause instanceof Error ? cause.message : String(cause)); }
      finally { if (scope.current === threadId) setPending(false); }
    }}>Retry merge</button></div>}
    {reviewRequired && canAccept && <span role="alert" className="mt-2 block text-xs text-muted-foreground">The thread changed since you reviewed it. Review the latest work, then click Accept anyway to confirm.</span>}
    {error && <span role="alert" className="mt-2 block text-xs text-destructive">{error}</span>}
  </div>;
}
