import { useEffect, useRef, useState } from "react";
import {
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  useComposer,
} from "@get-bb/plugin-sdk/app";

const resetEvent = "project-groups:new-thread";
let sidebarProjectId: string | null = null;
const sidebarAgent = { providerId: "codex", model: "gpt-6-sol", reasoningLevel: "medium" } as const;
const defaultAgent = { providerId: "codex", model: "gpt-6-astra", reasoningLevel: "medium" } as const;

/** Keep the native navigation and composer; only override the global entry's project. */
export function NewThreadNavigationDefaults() {
  const actions = experimental_useSidebarThreadActions();
  const { projects } = experimental_useSidebarThreads();
  const personalId = projects.find(project => project.isPersonal)?.id;
  useEffect(() => {
    if (!personalId) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const row = target.closest('[data-sidebar-navigation-item="__bb__/new-thread"]');
      // The row also contains an options button, which must retain its native menu.
      const button = target.closest("button");
      if (!row || !button || button !== row.querySelector("button") || button.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      sidebarProjectId = personalId;
      actions.openNewThread({ projectId: personalId, focusPrompt: true });
      window.dispatchEvent(new Event(resetEvent));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [actions, personalId]);
  return null;
}

/** A composer-scoped owner: existing threads and embedded plugin composers are untouched. */
export function NewThreadAgentDefaults() {
  const composer = useComposer();
  const latest = useRef(composer);
  latest.current = composer;
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    const apply = () => {
      if (latest.current.scope.kind !== "new-thread") return;
      // Navigation can mount the destination after the click event has fired.
      // Keep its intent until the personal composer is ready, then consume it.
      if (sidebarProjectId !== null && latest.current.scope.projectId !== sidebarProjectId) return;
      const agent = sidebarProjectId !== null ? sidebarAgent : defaultAgent;
      sidebarProjectId = null;
      setError(null);
      void latest.current.experimental_setSelection(agent).then(selection => {
        if (!disposed && (selection.providerId !== agent.providerId || selection.model !== agent.model || selection.reasoningLevel !== agent.reasoningLevel)) {
          setError(`${agent.model === "gpt-6-sol" ? "6-Sol" : "6-Astra"} Medium is unavailable on the selected machine. Choose an available agent.`);
        }
      }).catch(cause => {
        if (!disposed) setError(`Could not select the default agent: ${cause instanceof Error ? cause.message : String(cause)}`);
      });
    };
    apply();
    const applySidebarChoice = () => {
      if (sidebarProjectId !== null) apply();
    };
    window.addEventListener(resetEvent, applySidebarChoice);
    return () => { disposed = true; window.removeEventListener(resetEvent, applySidebarChoice); };
  }, []);
  return error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null;
}
