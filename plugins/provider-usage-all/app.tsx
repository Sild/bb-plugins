import { useEffect, useRef, useState } from "react";
import { definePluginApp, type ExperimentalSidebarFooterDisclosureProps } from "@get-bb/plugin-sdk/app";
import { loadUsage, resetLabel, type UsageMachine, type UsageProvider, type UsageWindow } from "./usage";

function WindowRow({ window }: { window: UsageWindow }) {
  const label = window.label.replace(/^Five-hour limit$|^Current session$/, "5h").replace(/^Weekly limit$/, "7d").replace(/^Daily limit$/, "1d");
  return <div className="grid grid-cols-[minmax(2rem,auto)_1fr_auto_auto] items-center gap-2 text-xs" title={window.resetsAt ? `Resets ${new Date(window.resetsAt).toLocaleString()}` : "Reset time unavailable"}>
    <span className="text-muted-foreground">{label}</span>
    <div role="meter" aria-label={window.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, window.usedPercent)} aria-valuetext={`${Math.round(window.usedPercent)}% used`} className="h-1 overflow-hidden rounded-full bg-sidebar-border">
      <div className={`h-full rounded-full ${window.usedPercent >= 95 ? "bg-destructive" : window.usedPercent >= 80 ? "bg-warning" : "bg-sidebar-foreground"}`} style={{ width: `${Math.max(0, Math.min(100, window.usedPercent))}%` }} />
    </div>
    <span className="tabular-nums">{Math.round(window.usedPercent)}%</span>
    <span className="min-w-12 text-right tabular-nums text-muted-foreground">{resetLabel(window.resetsAt)}</span>
    {window.cost && <span className="col-span-full text-muted-foreground">${(window.cost.usedUsdCents / 100).toFixed(2)} / ${(window.cost.limitUsdCents / 100).toFixed(2)}</span>}
  </div>;
}

function ProviderSection({ provider }: { provider: UsageProvider }) {
  const usage = provider.usage;
  let message: string | null = null;
  if (!usage) message = "Usage not reported.";
  else if (usage.status === "unauthenticated") message = provider.signInHint;
  else if (usage.status === "expired") message = provider.expiredHint;
  else if (usage.status === "error") message = usage.message;
  return <section aria-label={`${provider.displayName} usage`} className="space-y-2 py-3 first:pt-0 last:pb-0">
    <div className="flex items-center gap-2">
      {provider.logoUrl && <img src={provider.logoUrl} alt="" className="size-4 shrink-0" />}
      <h2 className="min-w-0 flex-1 truncate text-xs font-semibold">{provider.displayName}</h2>
      {usage?.status === "ok" && usage.planLabel && <span className="rounded bg-sidebar-border px-1 text-xs text-muted-foreground">{usage.planLabel}</span>}
    </div>
    {(provider.accountLabel || (usage?.status === "ok" && usage.accountEmail)) && <p className="truncate text-xs text-muted-foreground">{provider.accountLabel ?? (usage?.status === "ok" ? usage.accountEmail : null)}</p>}
    {message && <p className="text-xs text-muted-foreground">{message}</p>}
    {usage?.status === "ok" && (usage.windows.length
      ? <div className="space-y-1.5">{usage.windows.map((window, index) => <WindowRow key={`${index}:${window.label}`} window={window} />)}</div>
      : <p className="text-xs text-muted-foreground">No usage limits reported.</p>)}
  </section>;
}

export function UsagePanel({ dismiss }: ExperimentalSidebarFooterDisclosureProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [machines, setMachines] = useState<UsageMachine[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onClick = (event: MouseEvent) => {
      if (!event.composedPath().includes(panel)) dismiss();
    };
    panel.ownerDocument.addEventListener("click", onClick, true);
    return () => panel.ownerDocument.removeEventListener("click", onClick, true);
  }, [dismiss]);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function update(force: boolean) {
      if (pending) return;
      pending = true;
      setLoading(true);
      try {
        const result = await loadUsage(selectedId, force, controller.signal);
        if (controller.signal.aborted) return;
        setMachines(result.machines);
        setError(null);
      } catch {
        if (!controller.signal.aborted) setError("Couldn’t refresh usage. Previous values may be stale.");
      } finally {
        pending = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void update(refresh > 0);
    const onFocus = () => { if (document.visibilityState !== "hidden") void update(false); };
    const interval = window.setInterval(onFocus, 120_000);
    const clock = window.setInterval(() => tick(value => value + 1), 60_000);
    window.addEventListener("focus", onFocus);
    return () => { controller.abort(); window.clearInterval(interval); window.clearInterval(clock); window.removeEventListener("focus", onFocus); };
  }, [selectedId, refresh]);
  const machine = machines.find(item => item.id === selectedId)
    ?? machines.find(item => item.status === "connected" && item.providers.length > 0)
    ?? machines[0];
  const providers = machine?.providers.filter(provider => provider.usage?.status !== "not_installed") ?? [];
  return <div ref={panelRef} className="flex max-h-[65vh] flex-col text-sidebar-foreground">
    <div className="flex items-center gap-2 border-b border-sidebar-border px-2.5 py-2">
      <h2 className="flex-1 text-xs font-semibold">Provider usage</h2>
      <button type="button" aria-label="Refresh all providers" disabled={loading} onClick={() => setRefresh(value => value + 1)} className="size-7 rounded hover:bg-sidebar-accent disabled:opacity-50">↻</button>
      <button type="button" aria-label="Collapse provider usage" onClick={dismiss} className="size-7 rounded hover:bg-sidebar-accent">⌄</button>
    </div>
    {machines.length > 1 && <select aria-label="Usage source" value={machine?.id ?? ""} onChange={event => setSelectedId(event.target.value)} className="mx-2.5 mt-2 rounded border border-sidebar-border bg-sidebar p-1 text-xs">{machines.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select>}
    <div className="min-h-0 overflow-y-auto p-2.5" aria-busy={loading}>
      {loading && <p className="mb-2 text-xs text-muted-foreground">Refreshing all providers…</p>}
      {(error || machine?.error) && <p role="alert" className="mb-2 text-xs text-destructive">{error ?? machine?.error}</p>}
      {machine?.status === "disconnected" && <p className="mb-2 text-xs text-muted-foreground">Machine disconnected. Showing last reported usage.</p>}
      {!loading && !error && providers.length === 0 && <p className="text-xs text-muted-foreground">No connected providers report usage.</p>}
      <div className="divide-y divide-sidebar-border">{providers.map(provider => <ProviderSection key={provider.id} provider={provider} />)}</div>
    </div>
  </div>;
}

export default definePluginApp(app => {
  app.experimental_sidebarFooter.register({ kind: "disclosure", id: "usage", label: "Provider usage", icon: "ChartColumn", component: UsagePanel });
});
