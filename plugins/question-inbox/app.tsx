import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  definePluginApp,
  useRpc,
  useRealtime,
  useRealtimeConnectionState,
  useBbNavigate,
  useBbContext,
  useSidebarSplitLayout,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { answersSchema, type Answers, type QuestionRecord } from "./model";

import { questionContainer, questionPosition } from "./layout";

const OPEN = "bb-question-inbox-open";
const HEADER_READY = "bb-question-inbox-header-ready";
const button =
  "rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50";
function openQuestion(id?: string) {
  window.dispatchEvent(new CustomEvent(OPEN, { detail: id ?? null }));
}
function useQuestions(threadId?: string, offset = 0) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [data, setData] = useState<{
    records: QuestionRecord[];
    total: number;
  }>({ records: [], total: 0 });
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const value = await rpc.call("list", {
        ...(threadId ? { threadId } : {}),
        offset,
      });
      if (seq === sequence.current) {
        setData(value);
        setError(null);
      }
    } catch (e) {
      if (seq === sequence.current) setError(String(e));
    }
  }, [rpc, threadId, offset]);
  useEffect(() => {
    void refresh();
    return () => {
      sequence.current++;
    };
  }, [refresh, connection]);
  useRealtime("changed", refresh);
  useEffect(() => {
    const handle = () => {
      void refresh();
    };
    window.addEventListener("focus", handle);
    const timer = window.setInterval(handle, 15000);
    return () => {
      window.removeEventListener("focus", handle);
      window.clearInterval(timer);
    };
  }, [refresh]);
  return { ...data, error, refresh };
}
function QuestionForm({
  initial,
  paneId,
  onClose,
}: {
  initial: QuestionRecord;
  paneId?: string;
  onClose: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  const [position, setPosition] = useState(() =>
    questionPosition(
      { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight },
      { width: window.innerWidth, height: window.innerHeight },
    ),
  );
  useLayoutEffect(() => {
    let container: HTMLElement | null = null;
    const measure = () => {
      const next = questionContainer(initial.threadId, paneId);
      if (next !== container) {
        container = next;
        observer?.disconnect();
        // Ancestor resizing can move a pane without changing the pane's own size.
        for (let element = container; element; element = element.parentElement)
          observer?.observe(element);
      }
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      setPosition(
        questionPosition(
          container?.getBoundingClientRect() ?? {
            left: 0,
            top: 0,
            ...viewport,
          },
          viewport,
        ),
      );
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    measure();
    window.addEventListener(HEADER_READY, measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener(HEADER_READY, measure);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [initial.threadId, paneId]);
  const key = `bb-question-draft:${initial.id}`;
  const [record, setRecord] = useState(initial);
  const current = useRef(initial);
  const [recovery] = useState(() => {
    try {
      const cached = localStorage.getItem(key);
      if (cached) {
        const parsed = JSON.parse(cached);
        const draft = answersSchema.parse(parsed.draft);
        return {
          draft,
          conflict:
            Boolean(parsed.conflict) ||
            (parsed.revision !== initial.revision &&
              JSON.stringify(draft) !== JSON.stringify(initial.draft)),
        };
      }
    } catch {
      /* The server copy remains authoritative if local storage is unavailable. */
    }
    return { draft: initial.draft, conflict: false };
  });
  const [draft, setDraft] = useState<Answers>(recovery.draft);
  const [conflict, setConflict] = useState(recovery.conflict);
  const conflictRef = useRef(recovery.conflict);
  const draftRef = useRef(draft);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(false);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const updateRecord = (r: QuestionRecord) => {
    current.current = r;
    if (alive.current) setRecord(r);
  };
  const save = useCallback(
    (snoozed?: boolean) => {
      const snapshot = draftRef.current;
      const job = chain.current.then(async () => {
        if (conflictRef.current)
          throw new Error(
            "Resolve the draft conflict before saving or submitting.",
          );
        const r = current.current;
        if (r.status !== "open" && r.status !== "uncertain") return r;
        if (
          snoozed === undefined &&
          JSON.stringify(r.draft) === JSON.stringify(snapshot)
        )
          return r;
        const next = await rpc.call("save", {
          id: r.id,
          revision: r.revision,
          draft: snapshot,
          ...(snoozed === undefined ? {} : { snoozed }),
        });
        updateRecord(next);
        try {
          if (JSON.stringify(draftRef.current) === JSON.stringify(snapshot))
            localStorage.removeItem(key);
          else
            localStorage.setItem(
              key,
              JSON.stringify({
                revision: next.revision,
                draft: draftRef.current,
              }),
            );
        } catch {
          /* The saved server draft is intact. */
        }
        return next;
      });
      // Keep failures visible; do not refresh the revision and overwrite another window's edits.
      chain.current = job.catch(() => {});
      return job;
    },
    [rpc, key],
  );
  useEffect(() => {
    if (conflict) return;
    const timer = window.setTimeout(() => {
      void save().catch((e) => setError(String(e)));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draft, save, conflict]);
  function update(id: string, answer: Answers[string]) {
    const next = { ...draftRef.current, [id]: answer };
    draftRef.current = next;
    setDraft(next);
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          revision: current.current.revision,
          draft: next,
          conflict: conflictRef.current,
        }),
      );
    } catch {
      setError(
        "Local draft storage is unavailable. Keep this window open until the draft is saved.",
      );
    }
  }
  async function later() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await save(true);
      onClose();
    } catch (e) {
      try {
        localStorage.setItem(
          key,
          JSON.stringify({
            revision: current.current.revision,
            draft: draftRef.current,
            conflict: conflictRef.current,
          }),
        );
        toast.info("Your draft is saved on this device. You can answer later.");
        onClose();
      } catch {
        setError(
          `Could not save your draft. Keep this popup open. ${String(e)}`,
        );
      }
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await save();
      const r = current.current;
      const next = await rpc.call("answer", {
        id: r.id,
        revision: r.revision,
        answers: draftRef.current,
        retry,
      });
      updateRecord(next);
      try {
        localStorage.removeItem(key);
      } catch {
        /* The submitted answer is saved on the server. */
      }
      onClose();
    } catch (e) {
      setError(String(e));
      try {
        const fresh = await rpc.call("get", { id: initial.id });
        if (
          fresh.status === "open" &&
          fresh.revision !== current.current.revision
        ) {
          conflictRef.current = true;
          setConflict(true);
        }
        updateRecord(fresh);
      } catch {
        /* Retain the draft on disconnection. */
      }
    } finally {
      setBusy(false);
    }
  }
  return createPortal(
    <>
      <style>{`.question-inbox-dialog::backdrop { background: rgb(0 0 0 / 0.4); }`}</style>
      <dialog
        ref={dialog}
        aria-labelledby={`question-title-${initial.id}`}
        aria-describedby={`question-description-${initial.id}`}
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) void later();
        }}
        className="question-inbox-dialog rounded-xl border border-border bg-background text-foreground shadow-xl"
        style={{
          position: "fixed",
          ...position,
          right: "auto",
          bottom: "auto",
          margin: 0,
          transform: "translate(-50%, -50%)",
          padding: 0,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontSize: 14,
          lineHeight: 1.5,
        }}
      >
        <header
          style={{ padding: "16px 20px", flexShrink: 0 }}
          className="border-b border-border"
        >
          <h2
            tabIndex={-1}
            autoFocus
            id={`question-title-${initial.id}`}
            className="text-lg font-semibold"
          >
            Needs your answer
          </h2>
          <p
            id={`question-description-${initial.id}`}
            className="mt-1 text-sm text-muted-foreground"
          >
            {record.threadTitle}
          </p>
        </header>
        <div
          data-question-scroll
          style={{
            overflowY: "auto",
            minHeight: 0,
            padding: "16px 20px",
            overscrollBehavior: "contain",
          }}
        >
          <div className="space-y-5">
            {record.questions.map((q) => {
              const a = draft[q.id] ?? { selected: [] };
              const custom = !a.selected.length && a.freeText !== undefined;
              return (
                <fieldset
                  key={q.id}
                  disabled={
                    busy ||
                    record.status === "answered" ||
                    record.status === "closed"
                  }
                  className="space-y-2"
                >
                  <legend className="mb-2 whitespace-pre-wrap text-sm font-medium">
                    {q.prompt}
                  </legend>
                  {q.options.map((o) => (
                    <label
                      key={o.value}
                      className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:bg-muted"
                    >
                      <input
                        className="mt-1"
                        type={q.multiSelect ? "checkbox" : "radio"}
                        name={`${record.id}:${q.id}`}
                        checked={a.selected.includes(o.value)}
                        onChange={(e) =>
                          update(q.id, {
                            ...a,
                            selected: q.multiSelect
                              ? e.target.checked
                                ? [...a.selected, o.value]
                                : a.selected.filter((v) => v !== o.value)
                              : [o.value],
                          })
                        }
                      />
                      <span className="text-sm">
                        <span className="font-medium">{o.label}</span>
                        {o.description && (
                          <span className="mt-1 block text-muted-foreground">
                            {o.description}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                  {q.allowFreeText && (
                    <>
                      {q.options.length > 0 && (
                        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:bg-muted">
                          <input
                            className="mt-1"
                            type="radio"
                            name={`${record.id}:${q.id}`}
                            checked={custom}
                            onChange={() =>
                              update(q.id, {
                                selected: [],
                                freeText: a.freeText ?? "",
                              })
                            }
                          />
                          <span className="text-sm font-medium">
                            Custom answer
                          </span>
                        </label>
                      )}
                      <label className="block text-sm">
                        <span>
                          {a.selected.length
                            ? "Additional comments (optional)"
                            : "Your answer"}
                        </span>
                        <textarea
                          aria-label={
                            a.selected.length
                              ? `Additional comments: ${q.prompt}`
                              : `Answer: ${q.prompt}`
                          }
                          className="mt-1 w-full rounded-md border border-border bg-background p-2"
                          style={{
                            minHeight: 72,
                            maxHeight: 160,
                            resize: "vertical",
                          }}
                          placeholder={
                            a.selected.length
                              ? "Add context to your selected choice"
                              : "Write your custom answer"
                          }
                          value={a.freeText ?? ""}
                          maxLength={8000}
                          onChange={(e) =>
                            update(q.id, { ...a, freeText: e.target.value })
                          }
                        />
                      </label>
                    </>
                  )}
                  {a.selected.length > 0 && !q.allowFreeText && (
                    <button
                      className="text-xs underline"
                      onClick={() => update(q.id, { selected: [] })}
                    >
                      Clear selection
                    </button>
                  )}
                </fieldset>
              );
            })}
          </div>
          {conflict && (
            <div role="alert" className="mt-4 space-y-2 text-sm">
              <p>
                A newer draft was saved in another window. Choose which version
                to keep before continuing.
              </p>
              <button
                className={button}
                onClick={() => {
                  draftRef.current = record.draft;
                  setDraft(record.draft);
                  conflictRef.current = false;
                  setConflict(false);
                  setError(null);
                  try {
                    localStorage.removeItem(key);
                  } catch {}
                }}
              >
                Use saved draft
              </button>
              <button
                className={button}
                onClick={() => {
                  conflictRef.current = false;
                  setConflict(false);
                  setError(null);
                }}
              >
                Keep my draft
              </button>
            </div>
          )}
          {(error || record.error) && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {error ?? record.error}
            </p>
          )}
          {record.status === "uncertain" && (
            <label className="mt-3 flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={retry}
                onChange={(e) => setRetry(e.target.checked)}
              />
              I checked the thread; send this answer again.
            </label>
          )}
          {(record.status === "answered" || record.status === "closed") && (
            <p role="status" className="mt-3 text-sm">
              This question is already {record.status}.
            </p>
          )}
        </div>
        <footer
          style={{ padding: "12px 20px", flexShrink: 0 }}
          className="border-t border-border"
        >
          <p className="mb-2 text-xs text-muted-foreground">
            Answer later keeps your question and draft saved.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              className={button}
              onClick={() => navigate.toThread(record.threadId)}
            >
              Open thread
            </button>
            <button
              className={button}
              disabled={busy}
              onClick={() =>
                record.status === "answered" || record.status === "closed"
                  ? onClose()
                  : void later()
              }
            >
              Answer later
            </button>
            <button
              className={`${button} bg-primary text-primary-foreground`}
              disabled={
                busy ||
                conflict ||
                record.status === "answered" ||
                record.status === "closed" ||
                record.status === "delivering" ||
                (record.status === "uncertain" && !retry)
              }
              onClick={() => void submit()}
            >
              {busy ? "Saving…" : "Submit answer"}
            </button>
          </div>
        </footer>
      </dialog>
    </>,
    document.body,
  );
}
function Overlay() {
  const context = useBbContext();
  const layout = useSidebarSplitLayout();
  const threadId = layout
    ? layout.panes.find((pane) => pane.isFocused)?.threadId
    : context.threadId;
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const { total, error } = useQuestions();
  const [selected, setSelected] = useState<QuestionRecord | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  useEffect(() => {
    const handler = (event: Event) => {
      const id = (event as CustomEvent<string | null>).detail;
      if (!id) {
        navigate.toPluginPanel("inbox");
        return;
      }
      void rpc
        .call("get", { id })
        .then(setSelected)
        .catch((e) => setOpenError(String(e)));
    };
    window.addEventListener(OPEN, handler);
    return () => window.removeEventListener(OPEN, handler);
  }, [rpc, navigate]);
  return (
    <>
      {(total > 0 || error || openError) && (
        <button
          title={error ?? openError ?? "Open saved questions"}
          className="fixed bottom-5 right-5 z-50 rounded-full border border-border bg-background px-4 py-3 text-sm font-medium text-foreground shadow-lg"
          onClick={() => openQuestion()}
        >
          {error || openError
            ? "Question inbox needs attention"
            : `Needs your answer · ${total}`}
        </button>
      )}
      {selected && (
        <QuestionForm
          key={selected.id}
          initial={selected}
          paneId={
            selected.threadId === threadId
              ? layout?.panes.find((pane) => pane.isFocused)?.paneId
              : undefined
          }
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
function Inbox() {
  const [offset, setOffset] = useState(0);
  const { records, total, error, refresh } = useQuestions(undefined, offset);
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [closeError, setCloseError] = useState<string | null>(null);
  const closeQuestion = async (r: QuestionRecord) => {
    try {
      await rpc.call("close", { id: r.id, revision: r.revision });
      setCloseError(null);
      await refresh();
    } catch (e) {
      setCloseError(String(e));
    }
  };
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">
        Needs your answer{" "}
        <span className="text-muted-foreground">({total})</span>
      </h1>
      <p className="text-sm text-muted-foreground">
        Questions stay here until answered or dismissed. Archiving a thread
        dismisses its open questions.
      </p>
      {(error || closeError) && (
        <p role="alert" className="text-destructive">
          {error || closeError}
        </p>
      )}
      <button className={button} onClick={() => void refresh()}>
        Refresh
      </button>
      {!records.length && <p>No unanswered questions on this page.</p>}
      {records.map((r) => (
        <article
          key={r.id}
          className="space-y-3 rounded-lg border border-border p-4"
        >
          <button
            className="text-sm text-muted-foreground underline"
            onClick={() => navigate.toThread(r.threadId)}
          >
            {r.threadTitle}
          </button>
          <p className="whitespace-pre-wrap">{r.questions[0].prompt}</p>
          {r.questions.length > 1 && (
            <p className="text-sm">{r.questions.length} questions</p>
          )}
          {r.error && <p className="text-sm text-destructive">{r.error}</p>}
          <div className="flex gap-2">
            <button className={button} onClick={() => openQuestion(r.id)}>
              Answer
            </button>
            {(r.status === "open" || r.status === "uncertain") && (
              <button className={button} onClick={() => void closeQuestion(r)}>
                Dismiss
              </button>
            )}
          </div>
        </article>
      ))}
      <div className="flex gap-2">
        <button
          className={button}
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          Previous
        </button>
        <button
          className={button}
          disabled={offset + 50 >= total}
          onClick={() => setOffset(offset + 50)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
function Header({ threadId }: { threadId: string }) {
  useEffect(() => {
    window.dispatchEvent(new Event(HEADER_READY));
  }, [threadId]);
  const { records, total } = useQuestions(threadId);
  return (
    <span data-question-thread={threadId}>
      {total > 0 && (
        <button
          aria-label={`${total} questions need your answer`}
          title="Needs your answer"
          className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs hover:bg-muted"
          onClick={() => openQuestion(records[0]?.id)}
        >
          ﹖<span>{total}</span>
        </button>
      )}
    </span>
  );
}
export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "questions", component: Overlay });
  app.slots.experimental_threadHeaderAction({
    id: "questions",
    title: "Needs your answer",
    component: Header,
  });
  app.slots.navPanel({
    id: "inbox",
    path: "inbox",
    title: "Questions",
    icon: "MessageQuestion",
    component: Inbox,
  });
});
