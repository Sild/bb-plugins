import { useEffect, useRef, useState } from "react";
import { useComposer, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";

/** Seed once per project; later deliberate picker changes remain the user's choice. */
export function NewThreadWorktree() {
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const latest = useRef(composer); latest.current = composer;
  const projectId = composer.scope.kind === "new-thread" ? composer.scope.projectId : null;
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    setError(null); latest.current.setInputLock(true);
    const active = () => !disposed && latest.current.scope.kind === "new-thread" && latest.current.scope.projectId === projectId;
    async function apply() {
      const current = await latest.current.experimental_setSelection({});
      if (!active()) return;
      const environment = current.environment;
      const hostId = environment?.type === "host" ? environment.hostId ?? null : environment?.type === "provider" && environment.machine?.type === "existing" ? environment.machine.hostId : null;
      const choice = await rpc.call("board_task_defaults", { projectId, hostId });
      if (!active()) return;
      const requested = {
        providerId: choice.providerId, model: choice.model, reasoningLevel: choice.reasoningLevel,
        ...(choice.environment ? { environment: { type: "provider" as const, environmentProviderId: choice.environment.environmentProviderId, machine: { type: "existing" as const, hostId: choice.environment.hostId }, inputs: {} } } : {}),
      };
      await latest.current.experimental_setSelection(requested);
      if (!active()) return;
      // The host can reconcile the model again when the environment inputs become ready.
      // Reapply after that commit; never keep fighting subsequent user choices.
      const selected = await latest.current.experimental_setSelection({ providerId: choice.providerId, model: choice.model, reasoningLevel: choice.reasoningLevel });
      if (!active()) return;
      if (selected.providerId !== choice.providerId || selected.model !== choice.model || selected.reasoningLevel !== choice.reasoningLevel) throw new Error("GPT-6.1-Sol High is unavailable on the selected machine. Choose an available model.");
      if (choice.environment && selected.environment && (selected.environment.type !== "provider" || selected.environment.environmentProviderId !== choice.environment.environmentProviderId)) throw new Error("The default environment is unavailable on the selected machine. Choose an available environment.");
    }
    void apply().catch(cause => { if (active()) setError(`Could not apply new-task defaults: ${cause instanceof Error ? cause.message : String(cause)}`); }).finally(() => { if (active()) latest.current.setInputLock(false); });
    return () => { disposed = true; latest.current.setInputLock(false); };
  }, [projectId, rpc]);
  return error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null;
}
