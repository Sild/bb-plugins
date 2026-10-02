import { z } from "zod";

const windowSchema = z.object({
  label: z.string(), usedPercent: z.number(), resetsAt: z.string().nullable(),
  cost: z.object({ usedUsdCents: z.number(), limitUsdCents: z.number() }).nullable(),
});
const usageSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), accountEmail: z.string().nullable(), planLabel: z.string().nullable(), windows: z.array(windowSchema) }),
  z.object({ status: z.literal("not_installed") }),
  z.object({ status: z.literal("unauthenticated") }),
  z.object({ status: z.literal("expired") }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
const providerSchema = z.object({
  id: z.string(), providerId: z.string(), displayName: z.string(),
  accountLabel: z.string().nullable(), logoUrl: z.string().nullable(),
  signInHint: z.string(), expiredHint: z.string(), usage: usageSchema.nullable(),
});
const machineSchema = z.object({
  id: z.string(), displayName: z.string(), status: z.enum(["connected", "disconnected"]),
  providers: z.array(providerSchema), error: z.string().nullable(),
});
const responseSchema = z.object({ ok: z.literal(true), result: z.object({ machines: z.array(machineSchema) }) });
export type UsageMachine = z.infer<typeof machineSchema>;
export type UsageProvider = z.infer<typeof providerSchema>;
export type UsageWindow = z.infer<typeof windowSchema>;

// Keep the built-in collector's caching, account deduplication, and authentication.
export async function requestUsage(machineId: string | null, providerId: string | null, force: boolean, signal: AbortSignal) {
  const response = await fetch("/api/v1/plugins/provider-usage/rpc/getUsage", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ machineIds: machineId === null ? null : [machineId], providerId, force, maxAgeMs: force ? 0 : 120_000 }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
  });
  if (!response.ok) throw new Error(`Usage request failed (${response.status}).`);
  return responseSchema.parse(await response.json()).result.machines;
}

export async function loadUsage(selectedId: string | null, force: boolean, signal: AbortSignal): Promise<{ machines: UsageMachine[]; selectedId: string | null }> {
  const machines = await requestUsage(null, null, false, signal);
  const machine = machines.find(item => item.id === selectedId)
    ?? machines.find(item => item.status === "connected" && item.providers.length > 0)
    ?? machines[0];
  if (!machine || machine.status !== "connected") return { machines, selectedId: machine?.id ?? null };
  // Every provider refreshes independently; one failed source cannot hide another.
  const ids = [...new Set(machine.providers.map(provider => provider.providerId))];
  await Promise.all(ids.map(async providerId => {
    try {
      const result = await requestUsage(machine.id, providerId, force, signal);
      const updated = result.find(item => item.id === machine.id);
      if (!updated) throw new Error("Usage source disappeared.");
      machine.providers = machine.providers.map(provider => provider.providerId === providerId
        ? updated.providers.find(item => item.id === provider.id) ?? provider : provider);
      if (updated.error) machine.error = updated.error;
    } catch (error) {
      if (signal.aborted) throw error;
      machine.error = "Some usage could not be refreshed. Previous values may be stale.";
      machine.providers = machine.providers.map(provider => provider.providerId === providerId && provider.usage === null
        ? { ...provider, usage: { status: "error", message: "Usage could not be loaded." } } : provider);
    }
  }));
  return { machines, selectedId: machine.id };
}

export function resetLabel(value: string | null, now = Date.now()): string {
  if (!value) return "—";
  const remaining = new Date(value).getTime() - now;
  if (!Number.isFinite(remaining)) return "—";
  if (remaining <= 0) return "now";
  const minutes = Math.ceil(remaining / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
