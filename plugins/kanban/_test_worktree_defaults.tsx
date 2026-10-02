// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

afterEach(cleanup);
test("native task composer seeds a worktree from the current checkout and GPT-6.1-Sol Medium", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const customization = app.composerCustomizations.find(item => item.id === "task-worktree-default")!;
  expect(customization.scopes).toEqual(["new-thread"]);
  const slot = renderSlot(customization.banners![0], {}, {
    composer: { scope: { kind: "new-thread", projectId: "project" } },
    rpc: { board_task_defaults: () => ({ providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "medium", environment: {hostId: "machine", environmentProviderId: "kanban-task-worktree"} }) },
  });
  await waitFor(() => expect(slot.inspection.composer.selections).toEqual([{}, { providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "medium", environment: { type: "provider", environmentProviderId: "kanban-task-worktree", machine: { type: "existing", hostId: "machine" }, inputs: {} } }, { providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "medium" }]));
  await slot.behavior.setComposerText("Task draft"); expect(slot.inspection.composer.selections).toHaveLength(3);
});
test("personal and non-Git tasks retain their normal environment; errors are visible", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const banner = app.composerCustomizations.find(item => item.id === "task-worktree-default")!.banners![0];
  const slot = renderSlot(banner, {}, { composer: { scope: { kind: "new-thread", projectId: "personal" } }, rpc: { board_task_defaults: () => ({ providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "medium", environment: null }) } });
  await waitFor(() => expect(slot.inspection.composer.selections).toEqual([{}, { providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "medium" }, {providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "medium" }]));
  slot.lifecycle.unmount();
  renderSlot(banner, {}, { composer: { scope: { kind: "new-thread", projectId: "detached" } }, rpc: { board_task_defaults: () => { throw new Error("Choose a checked-out branch"); } } });
  expect((await screen.findByRole("alert")).textContent).toContain("Choose a checked-out branch");
});
test("the composer displays Merging... as Active without an Accept action", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const banner = app.composerCustomizations.find(item => item.id === "kanban-acceptance")!.banners![0];
  renderSlot(banner, {}, { composer: { scope: { kind: "thread", threadId: "merging" } }, rpc: { board_thread: () => ({ id: "merging", projectId: "p", title: "task", column: "active", status: "idle", merging: true, updatedAt: 1 }) } });
  expect((await screen.findByRole("status", { name: "Kanban status" })).textContent).toContain("Merging...");
  expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
});
test("input stays locked while the worktree choice loads and unlocks once seeded", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const banner = app.composerCustomizations.find(item => item.id === "task-worktree-default")!.banners![0];
  let finish: (value: { providerId: "codex"; model: string; reasoningLevel: "medium"; environment: { hostId: string; environmentProviderId: string } }) => void = () => {};
  const slot = renderSlot(banner, {}, { composer: { scope: { kind: "new-thread", projectId: "p" } }, rpc: { board_task_defaults: () => new Promise(resolve => { finish = resolve; }) } });
  await waitFor(() => expect(slot.inspection.composer.inputLocked).toBe(true));
  await waitFor(() => expect(slot.inspection.rpcCalls).toHaveLength(1));
  finish({ providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "medium", environment: {hostId: "h", environmentProviderId: "kanban-task-worktree"} });
  await waitFor(() => expect(slot.inspection.composer.inputLocked).toBe(false));
  expect(slot.inspection.composer.selections).toHaveLength(3);
});
