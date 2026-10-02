import { afterEach, expect, test } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

const disposers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); });
function setup(count = 4) {
  const threads = Array.from({ length: count }, (_, i) => makeThreadResponse({ id: `t${i}`, projectId: i === 1 ? "p2" : "p1", title: `Task ${i}`, status: "idle", updatedAt: i + 1 }));
  const metadata = new Map(threads.map(thread => [thread.id, { outcome: "done", outcomeRequestId: "turn1", unrelated: "keep" } as Record<string, unknown>]));
  const { bb, harness } = createFakePluginHost({ pluginId: "kanban", agentSkillIds: ["kanban-board"], sdk: {
    threads: {
      list: async args => args?.hasParent || args?.originPluginId ? [] : threads.filter(thread => !args?.projectId || thread.projectId === args.projectId).slice(args?.offset ?? 0, (args?.offset ?? 0) + (args?.limit ?? 500)).map(thread => ({ ...thread, hasPendingInteraction: false, activity: { activeBackgroundAgentCount: 0 } })),
      get: async ({ threadId }) => { const thread = threads.find(thread => thread.id === threadId); if (!thread) throw new Error("Missing task"); return thread; },
      getPluginMetadata: async ({ threadId }) => metadata.get(threadId) ?? {},
      updatePluginMetadata: async ({ threadId, set }) => Object.assign(metadata.get(threadId) ?? {}, set ?? {}),
      events: { list: async () => [{ id: "turn1" }] }, interactions: { list: async () => [] },
    },
  } });
  plugin(bb); disposers.push(() => harness.lifecycle.dispose());
  return { harness, threads, metadata };
}

test("previews only visible Done tasks in scope and pages beyond the board limit", async () => {
  const { harness, threads, metadata } = setup(505);
  threads[2].visibility = "hidden";
  threads[3].archivedAt = 9;
  metadata.get("t4")!.outcome = "waiting";
  metadata.get("t5")!.acceptedFor = threads[5].updatedAt;
  const scoped = await harness.behavior.callRpc("board_done", { projectIds: ["p1", "p1"] }) as { id: string }[];
  expect(scoped).toHaveLength(500);
  expect(scoped.some(card => card.id === "t504")).toBe(true);
  expect(scoped.some(card => ["t1", "t2", "t3", "t4", "t5"].includes(card.id))).toBe(false);
  expect(await harness.behavior.callRpc("board_done", { projectIds: [] })).toEqual([]);
  expect(await harness.behavior.callRpc("board_done", { projectIds: null })).toHaveLength(501);
});

test("accepts exact preview revisions once, continues after failures, and preserves unrelated metadata", async () => {
  const { harness, threads, metadata } = setup();
  const cards = await harness.behavior.callRpc("board_done", { projectIds: ["p1"] }) as { id: string; updatedAt: number }[];
  threads[2].updatedAt++;
  const revisions = cards.map(card => ({ threadId: card.id, expectedUpdatedAt: card.updatedAt }));
  const result = await harness.behavior.callRpc("board_accept_all", { projectIds: ["p1"], revisions: [...revisions, revisions[0]] });
  expect(result).toMatchObject({ accepted: 2, merging: 0, failed: 1, failures: [{ threadId: "t2", reason: expect.stringContaining("changed since the preview") }] });
  expect(metadata.get("t0")).toMatchObject({ acceptedFor: 1, acceptedAt: expect.any(Number), unrelated: "keep" });
  expect(metadata.get("t3")?.acceptedFor).toBe(4);
  expect(metadata.get("t2")?.acceptedFor).toBeUndefined();
  expect(metadata.get("t1")?.acceptedFor).toBeUndefined();
});

test("rechecks scope, visibility, archival, and activity at submission", async () => {
  const { harness, threads, metadata } = setup(6);
  threads[2].visibility = "hidden";
  threads[3].archivedAt = 9;
  threads[4].runtime.displayStatus = "active";
  const revisions = threads.map(thread => ({ threadId: thread.id, expectedUpdatedAt: thread.updatedAt }));
  expect(await harness.behavior.callRpc("board_accept_all", { projectIds: ["p1"], revisions })).toMatchObject({ accepted: 2, failed: 4 });
  for (const id of ["t1", "t2", "t3", "t4"]) expect(metadata.get(id)?.acceptedFor).toBeUndefined();
  threads[0].updatedAt++;
  expect(await harness.behavior.callRpc("board_accept_all", { projectIds: [], revisions: [revisions[0]] })).toMatchObject({ accepted: 0, failed: 1 });
});
