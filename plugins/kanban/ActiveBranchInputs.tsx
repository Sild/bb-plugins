import { useEffect, useRef, useState } from "react";
import { useRpc, type PluginEnvironmentProviderInputsProps } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";

/** Display the active checkout branch; creation reads it again on the machine. */
export function ActiveBranchInputs(props: PluginEnvironmentProviderInputsProps) {
  const rpc = useRpc<typeof rpcContract>();
  const onChange = useRef(props.onChange); onChange.current = props.onChange;
  const [branch, setBranch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hostId = props.target.kind === "existing-host" ? props.target.hostId : null;
  useEffect(() => {
    let disposed = false, running = false;
    setBranch(null); setError(null);
    onChange.current({ status: "blocked", reason: "Reading the active checkout branch" });
    async function refresh() {
      if (running) return; running = true;
      try {
        if (!props.projectId || !hostId) throw new Error("Choose an existing machine with a Git checkout.");
        const choice = await rpc.call("board_default_environment", { projectId: props.projectId, hostId });
        if (!choice) throw new Error("The selected project has no active Git checkout.");
        if (!disposed) { setBranch(choice.branch); setError(null); onChange.current({ status: "ready", value: {} }); }
      } catch (cause) {
        if (!disposed) { const message = cause instanceof Error ? cause.message : String(cause); setError(message); onChange.current({ status: "blocked", reason: message }); }
      } finally { running = false; }
    }
    void refresh(); const timer = setInterval(() => void refresh(), 2000);
    return () => { disposed = true; clearInterval(timer); };
  }, [props.projectId, hostId, rpc]);
  return error ? <span role="alert" className="text-xs text-destructive">{error}</span> : <span className="text-sm text-muted-foreground">Branch from: <strong className="text-foreground">{branch ?? "Loading..."}</strong></span>;
}
