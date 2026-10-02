// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UsagePanel } from "./app";
import { loadUsage, type UsageMachine } from "./usage";
vi.mock("@get-bb/plugin-sdk/app", () => ({ definePluginApp: (setup: unknown) => setup }));

function machine(): UsageMachine {
  return { id: "local", displayName: "Local", status: "connected", error: null,
    providers: ["Codex", "Claude", "Cursor"].map(name => ({ id: name, providerId: name, displayName: name,
      accountLabel: null, logoUrl: null, signInHint: `Sign in to ${name}`, expiredHint: `Renew ${name}`, usage: null })) };
}
function fetchStub(failClaude = false) {
  return vi.fn(async (_url: unknown, options: RequestInit) => {
    const { providerId } = JSON.parse(options.body as string);
    if (providerId === "Claude" && failClaude) throw new Error("offline");
    const result = machine();
    result.providers = result.providers.map(provider => ({ ...provider, usage: provider.providerId !== providerId ? null
      : providerId === "Cursor" ? { status: "not_installed" }
      : { status: "ok", accountEmail: null, planLabel: "Pro", windows: [{ label: "Weekly limit", usedPercent: providerId === "Claude" ? 34 : 30, resetsAt: null, cost: null }] } }));
    return { ok: true, json: async () => ({ ok: true, result: { machines: [result] } }) };
  });
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("combined usage", () => {
  it("dismisses on outside clicks, including stopped propagation, and cleans up on unmount", async () => {
    vi.stubGlobal("fetch", fetchStub());
    const dismiss = vi.fn();
    const { unmount } = render(<UsagePanel dismiss={dismiss} />);
    await screen.findByRole("region", { name: "Claude usage" });
    fireEvent.click(screen.getByText("Provider usage"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh all providers" }));
    expect(dismiss).not.toHaveBeenCalled();

    const outside = document.createElement("button");
    outside.addEventListener("click", event => event.stopPropagation());
    document.body.append(outside);
    try {
      fireEvent.click(outside);
      expect(dismiss).toHaveBeenCalledTimes(1);
      unmount();
      fireEvent.click(outside);
      expect(dismiss).toHaveBeenCalledTimes(1);
    } finally {
      outside.remove();
    }
  });
  it("renders both providers without tabs and refreshes every provider", async () => {
    const fetch = fetchStub(); vi.stubGlobal("fetch", fetch);
    render(<UsagePanel dismiss={() => {}} />);
    await screen.findByRole("region", { name: "Claude usage" });
    expect(screen.getByRole("region", { name: "Codex usage" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Cursor usage" })).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByText("34%")).toBeTruthy();
    expect(screen.getByText("30%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh all providers" }));
    await waitFor(() => expect(fetch.mock.calls.filter(([, input]) => JSON.parse(input.body as string).force)).toHaveLength(3));
  });
  it("keeps healthy provider data and shows another provider's collection failure", async () => {
    vi.stubGlobal("fetch", fetchStub(true));
    const result = await loadUsage(null, false, new AbortController().signal);
    expect(result.machines[0]?.providers.find(item => item.providerId === "Codex")?.usage?.status).toBe("ok");
    expect(result.machines[0]?.providers.find(item => item.providerId === "Claude")?.usage?.status).toBe("error");
    expect(result.machines[0]?.error).toContain("could not be refreshed");
  });
});
