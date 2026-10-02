import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

afterEach(() => { cleanup(); document.body.replaceChildren(); });

const projects = [{ id: "personal", name: "Personal", isPersonal: true, href: "/personal", settingsHref: "/personal/settings" }];

test("global New thread selects personal, preserves other buttons, and disposes its listener", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(app.appOverlays.find(slot => slot.id === "new-thread-navigation-defaults")!, {}, {
    sidebarThreads: { status: "ready", projects, threads: [] },
  });
  const row = document.createElement("div");
  row.dataset.sidebarNavigationItem = "__bb__/new-thread";
  row.innerHTML = '<button><span>New thread</span></button><button>Options</button>';
  document.body.append(row);
  const nativeClick = vi.fn();
  row.addEventListener("click", nativeClick);
  fireEvent.click(row.querySelector("span")!);
  expect(slot.inspection.sidebarActionCalls).toEqual([{ method: "openNewThread", options: { projectId: "personal", focusPrompt: true } }]);
  expect(nativeClick).not.toHaveBeenCalled();
  // A destination mounted after navigation must still receive the sidebar choice.
  const banner = app.composerCustomizations.find(item => item.id === "new-thread-agent-defaults")!.banners![0];
  const composer = renderSlot(banner, {}, { composer: { scope: { kind: "new-thread", projectId: "personal" } } });
  const sol = { providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "high" };
  await waitFor(() => expect(composer.inspection.composer.selections).toEqual([sol]));
  // The same button also resets an already open composer.
  fireEvent.click(row.firstElementChild!);
  await waitFor(() => expect(composer.inspection.composer.selections).toEqual([sol, sol]));
  fireEvent.click(row.lastElementChild!);
  fireEvent.click(row.firstElementChild!, { ctrlKey: true });
  expect(nativeClick).toHaveBeenCalledTimes(2);
  expect(slot.inspection.sidebarActionCalls).toHaveLength(2);
  slot.lifecycle.unmount();
  fireEvent.click(row.firstElementChild!);
  expect(nativeClick).toHaveBeenCalledTimes(3);
});

test("new task defaults use GPT-6.1-Sol High without changing project, permission, or service tier", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const customization = app.composerCustomizations.find(item => item.id === "new-thread-agent-defaults")!;
  expect(customization.scopes).toEqual(["new-thread"]);
  const slot = renderSlot(customization.banners![0], {}, {
    composer: { scope: { kind: "new-thread", projectId: "chosen-project" } },
  });
  const expected = { providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "high" };
  await waitFor(() => expect(slot.inspection.composer.selections).toEqual([expected]));
  await slot.behavior.setComposerText("Keep my draft");
  expect(slot.inspection.composer.selections).toHaveLength(1);
  fireEvent(window, new Event("project-groups:new-thread"));
  await waitFor(() => expect(slot.inspection.composer.selections).toEqual([expected]));
  expect(slot.inspection.composer.text).toBe("Keep my draft");
});
