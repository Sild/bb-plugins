import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

const dispose: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(dispose.splice(0).map(fn => fn())); });
function setup(path: string, kind = "standard", isGit = true) {
  const { bb, harness } = createFakePluginHost({ pluginId: "kanban", agentSkillIds: ["kanban-board"],
    experimental_callHostRpc: async () => ({ isGit, branch: "current-feature", clean: true, operation: false }),
    sdk: { projects: { get: async () => ({ id: "p", name: "Renamed project", kind, sources: [{ type: "local_path", path, hostId: "h", isDefault: true }] }) } },
  });
  plugin(bb); dispose.push(() => harness.lifecycle.dispose()); return harness;
}
test.each([
  [join(homedir(), "Obsidian"), "project-checkout"],
  [`${join(homedir(), "Obsidian")}/`, "project-checkout"],
  [join(homedir(), "Projects/Personal/bb-plugins"), "project-checkout"],
  [`${join(homedir(), "Projects/Personal/bb-plugins")}/`, "project-checkout"],
  ["/Users/sild/Projects/Personal/videogen", "kanban-task-worktree"],
])("new tasks at %s choose %s and read the current branch", async (path, provider) => {
  const harness = setup(path);
  expect(await harness.behavior.callRpc("board_default_environment", { projectId: "p", hostId: "h" })).toMatchObject({ hostId: "h", branch: "current-feature", environmentProviderId: provider });
  expect(await harness.behavior.callRpc("board_task_defaults", { projectId: "p", hostId: "h" })).toMatchObject({ providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "medium", environment: { hostId: "h", environmentProviderId: provider } });
});
test("no-project and personal tasks have model defaults without a worktree", async () => {
  const harness = setup("/personal", "personal");
  for (const projectId of [null, "p"]) expect(await harness.behavior.callRpc("board_task_defaults", { projectId, hostId: null })).toMatchObject({ model: "gpt-6.1-sol", reasoningLevel: "medium", environment: null });
});
test("non-Git projects retain their normal environment", async () => {
  const harness = setup("/notes", "standard", false);
  expect(await harness.behavior.callRpc("board_task_defaults", { projectId: "p", hostId: null })).toMatchObject({ environment: null });
});
test.each([false, true])("automatic plan acceptance verifies native or workflow ancestry (%s)", async workflow => {
  const plan = makeThreadResponse({ id: "plan", title: "[PLAN] Task", parentThreadId: workflow ? null : "root", originPluginId: workflow ? "review-implement" : null, status: "idle" });
  const review = makeThreadResponse({ id: "review", title: "[👁] Task", parentThreadId: workflow ? null : "plan", originPluginId: workflow ? "review-implement" : null, status: "idle" });
  plan.runtime.displayStatus = review.runtime.displayStatus = "idle";
  const metadata: Record<string, Record<string, unknown>> = { plan: { outcome: "done", outcomeRequestId: "turn" }, review: { outcome: "done", outcomeRequestId: "turn" } };
  const { bb, harness } = createFakePluginHost({ pluginId: "kanban", agentSkillIds: ["kanban-board"], sdk: { threads: {
    get: async ({ threadId }) => threadId === "plan" ? plan : review, list: async () => [], interactions: { list: async () => [] }, events: { list: async () => [{ id: "turn" }] },
    getPluginMetadata: async ({ threadId, pluginId }) => pluginId === "review-implement" ? { workflowParentThreadId: threadId === "plan" ? "root" : "plan" } : metadata[threadId], updatePluginMetadata: async ({ threadId, set }) => Object.assign(metadata[threadId], set),
  } } });
  plugin(bb); dispose.push(() => harness.lifecycle.dispose());
  const input = { threadId: "plan", parentThreadId: "root", reviewThreadId: "review" };
  await expect(harness.behavior.callRpc("board_accept_plan", input)).rejects.toThrow("accepted independent review");
  await harness.behavior.callRpc("board_accept_review", { threadId: "review", parentThreadId: "plan" });
  expect(await harness.behavior.callRpc("board_accept_plan", input)).toMatchObject({ column: "accepted" });
  plan.title = "[</>] Task";
  await expect(harness.behavior.callRpc("board_accept_plan", input)).rejects.toThrow("Only a reviewed plan");
});
