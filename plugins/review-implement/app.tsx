import { useRef, useState } from "react";
import { definePluginApp, useBbNavigate, useComposer, useComposerView, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import "./styles.css";

type Action = "design" | "plan" | "implementation";
const actions: Array<{ kind: Action; label: string; description: string; path: string }> = [
  { kind: "design", label: "Design", description: "Project design plan · Sol 6.1 Extra High · independent review", path: "M4 4h6v6H4zM14 14h6v6h-6zM14 4h6v6h-6zM7 10v7h7M10 7h4" },
  { kind: "plan", label: "Plan", description: "Detailed implementation plan · Sol 6.1 Extra High · independent review", path: "M9 5h11M9 12h11M9 19h11M3 5h1M3 12h1M3 19h1" },
  { kind: "implementation", label: "Implement", description: "Implement the plan · Sol 6.1 High · independent review", path: "m8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16" },
];

export function WorkflowActions({ placement = "action" }: { placement?: "action" | "banner" }) {
  const { scope, draft } = useComposerView();
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const pending = useRef(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState("");
  if (scope.kind !== "thread") return null;
  const threadId = scope.threadId;
  async function start(kind: Action) {
    if (pending.current || draft.attachmentCount > 0) return;
    pending.current = true; setBusy(kind); setError("");
    const instruction = draft.text;
    try {
      const result = kind === "implementation"
        ? await rpc.call("startImplementation", { threadId, instruction })
        : await rpc.call("startPlan", { threadId, kind, instruction });
      composer.updateText(current => current === instruction ? "" : current);
      navigate.toThread(result.childThreadId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; setBusy(null); }
  }
  return <div className={`workflow-actions workflow-placement-${placement}`}>
    <div role="group" aria-label="Reviewed agent workflows" className="workflow-action-group">
      {actions.map(action => <button key={action.kind} type="button" disabled={busy !== null || draft.attachmentCount > 0}
        onClick={() => void start(action.kind)} aria-label={action.description}
        title={draft.attachmentCount > 0 ? "Send attached files to the thread first so the new agent inherits them." : action.description}
        aria-busy={busy === action.kind} className="workflow-action">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={action.path} /></svg>
        <span>{busy === action.kind ? `${action.label}…` : action.label}</span>
      </button>)}
    </div>
    {error && <span role="alert" className="workflow-error">{error}</span>}
  </div>;
}

export default definePluginApp(app => {
  app.composer.customize({ id: "review-implement", scopes: ["thread"], actions: [{ id: "workflows", component: WorkflowActions }], banners: [{ id: "narrow-workflows", chrome: "bare", component: () => <WorkflowActions placement="banner" /> }] });
});
