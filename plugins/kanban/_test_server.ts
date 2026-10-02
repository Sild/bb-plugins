import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost, makeMessageDispatchHookContext, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

const disposers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); });

function setup() {
  const thread = makeThreadResponse({ id: "t1", projectId: "p1", title: "Implement board", status: "idle" });
  const metadata: Record<string, unknown> = { outcome: "done", outcomeRequestId: "turn1", column: "in-progress", unrelated: "keep" };
  const { bb, harness } = createFakePluginHost({
    pluginId: "kanban", agentSkillIds: ["kanban-board"],
    sdk: {
      projects: { list: async () => [{ id: "p1", name: "One", kind: "standard" }, { id: "p2", name: "Two", kind: "standard" }] },
      plugins: { callRpc: async () => ({ groups: [{ id: "work", name: "Work", sign: "W", position: 0, iconName: null, iconColor: "#38c878" }], assignments: { p1: "work" }, pinnedProjectIds: [] }) },
      threads: {
        list: async (args) => args?.hasParent || args?.originPluginId ? [] : [{ ...thread, ...(args?.projectId === "p2" ? { id: "t2", projectId: "p2" } : {}), hasPendingInteraction: false, activity: { activeBackgroundAgentCount: 0 } }],
        get: async () => thread,
        interactions: { list: async () => [] },
        events: { list: async () => [{ id: "turn1" }] },
        getPluginMetadata: async () => metadata,
        updatePluginMetadata: async ({ set }) => Object.assign(metadata, set ?? {}),
      },
    },
  });
  plugin(bb);
  disposers.push(() => harness.lifecycle.dispose());
  return { harness, metadata, thread };
}

describe("board API", () => {
  it("holds only Kanban draft submissions and their queued retries", async () => {
    const { harness } = setup();
    const dispatch = harness.inspection.registrations.hooks["message.dispatch"]!;
    const draft = makeMessageDispatchHookContext({ experimental_submission: { pluginId: "kanban", data: { kind: "draft" } } });
    expect(await dispatch(draft)).toEqual({ action: "wait", reason: "Draft" });
    expect(await dispatch(makeMessageDispatchHookContext({ queuedMessages: [{ waitingOn: { kind: "plugin", pluginId: "kanban", reason: "Draft" } }] }))).toEqual({ action: "wait", reason: "Draft" });
    expect(await dispatch(makeMessageDispatchHookContext({ queuedMessages: [{ waitingOn: { kind: "plugin", pluginId: "kanban", reason: "Merging..." } }] }))).toEqual({ action: "proceed" });
    expect(await dispatch(makeMessageDispatchHookContext())).toEqual({ action: "proceed" });
    expect(await dispatch(makeMessageDispatchHookContext({ experimental_submission: { pluginId: "drafts", data: { kind: "draft" } } }))).toEqual({ action: "proceed" });
  });
  it("queries every selected project and derives columns despite legacy saved metadata", async () => {
    const { harness } = setup();
    const result = await harness.behavior.callRpc("board_list", { projectIds: ["p1", "p2", "p1"] });
    expect(result).toMatchObject({ cards: [{ id: "t1", column: "done" }, { id: "t2", column: "done" }] });
    expect(harness.inspection.sdk.callsTo("threads.list").filter((call) => !(call[0] as { hasParent?: boolean }).hasParent && !(call[0] as { originPluginId?: string }).originPluginId)).toHaveLength(2);
  });
  it("keeps parents Active for working child threads across board, composer, and acceptance", async () => {
    const { harness, metadata, thread } = setup();
    const child = makeThreadResponse({ id: "child", parentThreadId: thread.id, projectId: "p2", status: "active" });
    child.runtime.displayStatus = "active";
    const row = (value: typeof thread) => ({ ...value, hasPendingInteraction: false, activity: { activeBackgroundAgentCount: 0 } });
    harness.inspection.sdk.stub("threads.list", async (args: { hasParent?: boolean; originPluginId?: string } | undefined) => args?.originPluginId ? [] : args?.hasParent ? [row(child)] : [row(thread)]);
    metadata.outcome = "waiting";
    expect(await harness.behavior.callRpc("board_list", { projectIds: ["p1"] })).toMatchObject({ cards: [{ id: "t1", column: "active" }] });
    expect(await harness.behavior.callRpc("board_thread", { threadId: "t1" })).toMatchObject({ column: "active" });
    metadata.outcome = "done";
    harness.inspection.sdk.stub("threads.interactions.list", async () => [{ id: "pending" }]);
    expect(await harness.behavior.callRpc("board_thread", { threadId: "t1" })).toMatchObject({ column: "active" });
    await expect(harness.behavior.callRpc("board_accept", { threadId: "t1", expectedUpdatedAt: thread.updatedAt, acknowledgeChanges: true })).rejects.toThrow("Only a Done");
    child.status = "idle";
    child.runtime.displayStatus = "idle";
    expect(await harness.behavior.callRpc("board_thread", { threadId: "t1" })).toMatchObject({ column: "waiting" });
    harness.inspection.sdk.stub("threads.interactions.list", async () => []);
    expect(await harness.behavior.callRpc("board_thread", { threadId: "t1" })).toMatchObject({ column: "done" });
  });
  it("includes hidden grandchildren beyond the first child page", async () => {
    const { harness, thread } = setup();
    const child = makeThreadResponse({ id: "child", parentThreadId: thread.id, status: "idle" });
    const grandchild = makeThreadResponse({ id: "grandchild", parentThreadId: child.id, status: "active" });
    grandchild.runtime.displayStatus = "active";
    const rows = [child, ...Array.from({ length: 499 }, (_, i) => makeThreadResponse({ id: `other${i}`, parentThreadId: "other", status: "idle" })), grandchild]
      .map((value) => ({ ...value, hasPendingInteraction: false, activity: { activeBackgroundAgentCount: 0 } }));
    harness.inspection.sdk.stub("threads.list", async (args: { offset?: number; limit?: number; originPluginId?: string } | undefined) => {
      if (args?.originPluginId) return [];
      expect(args).toMatchObject({ hasParent: true, archived: false, includeHidden: true });
      return rows.slice(args?.offset ?? 0, (args?.offset ?? 0) + (args?.limit ?? 500));
    });
    expect(await harness.behavior.callRpc("board_thread", { threadId: "t1" })).toMatchObject({ column: "active" });
    expect(harness.inspection.sdk.callsTo("threads.list")).toHaveLength(3);
  });
  it("treats an empty selection as none, not all projects", async () => {
    const { harness } = setup();
    expect(await harness.behavior.callRpc("board_list", { projectIds: [] })).toMatchObject({ cards: [] });
    expect(harness.inspection.sdk.callsTo("threads.list")).toHaveLength(0);
  });
  it("accepts Done only, preserves metadata, and invalidates acceptance on new activity", async () => {
    const { harness, metadata, thread } = setup();
    expect(await harness.behavior.callRpc("board_accept", { threadId: "t1", expectedUpdatedAt: thread.updatedAt })).toMatchObject({ column: "accepted" });
    expect(metadata).toEqual({ outcome: "done", outcomeRequestId: "turn1", column: "in-progress", unrelated: "keep", acceptedFor: thread.updatedAt, acceptedAt: expect.any(Number) });
    thread.updatedAt++;
    expect(await harness.behavior.callRpc("board_accept", { threadId: "t1", expectedUpdatedAt: thread.updatedAt - 1 })).toMatchObject({ column: "done", reviewRequired: true });
    expect(metadata.acceptedFor).toBe(thread.updatedAt - 1);
    thread.updatedAt++;
    expect(await harness.behavior.callRpc("board_accept", { threadId: "t1", expectedUpdatedAt: thread.updatedAt - 2, acknowledgeChanges: true })).toMatchObject({ column: "accepted" });
    expect(metadata.acceptedFor).toBe(thread.updatedAt);
    thread.updatedAt++;
    expect(await harness.behavior.callRpc("board_thread", { threadId: "t1" })).toMatchObject({ column: "done" });
    harness.inspection.sdk.stub("threads.interactions.list", async () => [{ id: "pending" }]);
    await expect(harness.behavior.callRpc("board_accept", { threadId: "t1", expectedUpdatedAt: thread.updatedAt, acknowledgeChanges: true })).rejects.toThrow("Only a Done");
  });
  it("automatically accepts only a completed review subthread after its handoff", async () => {
    const { harness, metadata, thread } = setup();
    thread.parentThreadId = "parent";
    thread.title = "[👁][</>] Plan";
    expect(await harness.behavior.callRpc("board_accept_review", { threadId: "t1", parentThreadId: "parent" })).toMatchObject({ column: "accepted" });
    expect(metadata.acceptedFor).toBe(thread.updatedAt);
    for (const title of ["[👁][PLAN] Plan", "[👁][DESIGN] Plan"]) {
      thread.title = title;
      metadata.acceptedFor = null;
      expect(await harness.behavior.callRpc("board_accept_review", { threadId: "t1", parentThreadId: "parent" })).toMatchObject({ column: "accepted" });
    }
    thread.title = "[👁] Plan";
    expect(await harness.behavior.callRpc("board_accept_review", { threadId: "t1", parentThreadId: "parent" })).toMatchObject({ column: "accepted" });
    thread.title = "↳ Review: Plan";
    expect(await harness.behavior.callRpc("board_accept_review", { threadId: "t1", parentThreadId: "parent" })).toMatchObject({ column: "accepted" });
    await expect(harness.behavior.callRpc("board_accept_review", { threadId: "t1", parentThreadId: "other" })).rejects.toThrow("Only a review");
    thread.updatedAt++;
    delete metadata.outcome;
    await expect(harness.behavior.callRpc("board_accept_review", { threadId: "t1", parentThreadId: "parent" })).rejects.toThrow("idle and Done");
  });
  it.each(["PLAN", "DESIGN"])("accepts a %s artifact only after its stage-prefixed independent review is accepted", async stage => {
    const { harness, metadata, thread } = setup();
    thread.title = `[${stage}] Project`;
    thread.parentThreadId = "root";
    const review = makeThreadResponse({ id: "review", title: `[👁][${stage}] Project`, parentThreadId: thread.id, status: "idle" });
    const reviewMetadata: Record<string, unknown> = { outcome: "done", outcomeRequestId: "turn1" };
    harness.inspection.sdk.stub("threads.get", async ({ threadId }: { threadId: string }) => threadId === review.id ? review : thread);
    harness.inspection.sdk.stub("threads.getPluginMetadata", async ({ threadId }: { threadId: string }) => threadId === review.id ? reviewMetadata : metadata);
    harness.inspection.sdk.stub("threads.updatePluginMetadata", async ({ threadId, set }: { threadId: string; set: Record<string, unknown> }) => Object.assign(threadId === review.id ? reviewMetadata : metadata, set));
    const input = { threadId: thread.id, parentThreadId: "root", reviewThreadId: review.id };
    await expect(harness.behavior.callRpc("board_accept_plan", input)).rejects.toThrow("accepted independent review");
    expect(await harness.behavior.callRpc("board_accept_review", { threadId: review.id, parentThreadId: thread.id })).toMatchObject({ column: "accepted" });
    expect(await harness.behavior.callRpc("board_accept_plan", input)).toMatchObject({ column: "accepted" });
    expect(metadata.acceptedFor).toBe(thread.updatedAt);
    review.updatedAt++;
    await expect(harness.behavior.callRpc("board_accept_plan", input)).rejects.toThrow("accepted independent review");
  });
  it("keeps idle questions Waiting and rejects completion from an earlier turn", async () => {
    const { harness, metadata, thread } = setup();
    delete metadata.outcome;
    expect(await harness.behavior.callRpc("board_thread", { threadId: "t1" })).toMatchObject({ column: "waiting" });
    await expect(harness.behavior.callRpc("board_accept", { threadId: "t1", expectedUpdatedAt: thread.updatedAt, acknowledgeChanges: true })).rejects.toThrow("Only a Done");
    metadata.outcome = "done";
    harness.inspection.sdk.stub("threads.events.list", async () => [{ id: "turn2" }]);
    expect(await harness.behavior.callRpc("board_thread", { threadId: "t1" })).toMatchObject({ column: "waiting" });
  });
  it("reports only the current thread outcome and preserves unrelated metadata", async () => {
    const { harness, metadata } = setup();
    expect(await harness.behavior.runCli(["report", "waiting"], { threadId: "t1" })).toMatchObject({ exitCode: 0 });
    expect(metadata).toMatchObject({ outcome: "waiting", outcomeRequestId: "turn1", unrelated: "keep", acceptedFor: null });
    expect(await harness.behavior.callRpc("board_thread", { threadId: "t1" })).toMatchObject({ column: "waiting" });
    expect(await harness.behavior.runCli(["report", "done"], { threadId: "t1" })).toMatchObject({ exitCode: 0 });
    expect(await harness.behavior.callRpc("board_thread", { threadId: "t1" })).toMatchObject({ column: "done" });
    expect(await harness.behavior.runCli(["report", "done"])).toMatchObject({ exitCode: 1 });
  });
  it("keeps threads available with an explicit warning if folder lookup fails", async () => {
    const { harness } = setup();
    harness.inspection.sdk.stub("plugins.callRpc", async () => { throw new Error("Plugin disabled"); });
    expect(await harness.behavior.callRpc("board_list", { projectIds: null })).toMatchObject({ folders: [{ name: "Other projects", projectIds: ["p1", "p2"] }], folderWarning: expect.stringContaining("unavailable") });
  });
});


it("archive history filters by acceptance time, sorts descending, and is opt-in", async () => {
  const { harness, thread } = setup();
  const now = Date.now();
  const rows = [
    {id: "older", acceptedAt: now - 5 * 86400000},
    {id: "newer", acceptedAt: now - 86400000},
    {id: "outside", acceptedAt: now - 15 * 86400000},
    {id: "undated", acceptedAt: null},
  ];
  harness.inspection.sdk.stub("threads.list", async (args: {archived?: boolean; hasParent?: boolean}) => args.archived ? rows.map(row => ({...thread, id: row.id, visibility: "visible", archivedAt: now, hasPendingInteraction: false, activity: {activeBackgroundAgentCount: 0}})) : []);
  harness.inspection.sdk.stub("threads.getPluginMetadata", async ({threadId}: {threadId: string}) => ({acceptedAt: rows.find(row => row.id === threadId)?.acceptedAt}));
  expect(await harness.behavior.callRpc("board_list", {projectIds: ["p1"]})).toMatchObject({cards: []});
  expect(harness.inspection.sdk.callsTo("threads.list").some(call => (call[0] as {archived?: boolean}).archived)).toBe(false);
  const result = await harness.behavior.callRpc("board_list", {projectIds: ["p1"], archiveDays: 7}) as {cards: {id: string}[]; archiveUndated: number};
  expect(result.cards.map(card => card.id)).toEqual(["newer", "older", "undated"]);
  expect(result.archiveUndated).toBe(1);
  expect(await harness.behavior.callRpc("board_list", {projectIds: [], archiveDays: 365})).toMatchObject({cards: []});
});

it("finds recently accepted archive entries beyond the first page before applying the display limit", async () => {
  const { harness, thread } = setup();
  const now = Date.now();
  const rows = Array.from({length: 501}, (_,i) => ({...thread, id: `a${i}`, archivedAt: now, visibility: "visible", hasPendingInteraction: false, activity: {activeBackgroundAgentCount: 0}}));
  harness.inspection.sdk.stub("threads.list", async (args: {archived?: boolean; offset?: number; limit?: number}) => args.archived ? rows.slice(args.offset ?? 0, (args.offset ?? 0) + (args.limit ?? 500)) : []);
  harness.inspection.sdk.stub("threads.getPluginMetadata", async ({threadId}: {threadId: string}) => ({acceptedAt: now - (threadId === "a500" ? 86400000 : 20 * 86400000)}));
  const result = await harness.behavior.callRpc("board_list", {projectIds: ["p1"], archiveDays: 7}) as {cards: {id: string}[]};
  expect(result.cards.map(card => card.id)).toEqual(["a500"]);
});

it("keeps native-detached workflow ancestors active through public metadata", async () => {
  const { harness, thread } = setup();
  const child = makeThreadResponse({ id: "plan", parentThreadId: null, originPluginId: "review-implement", status: "idle" });
  const review = makeThreadResponse({ id: "review", parentThreadId: null, originPluginId: "review-implement", status: "active" });
  review.runtime.displayStatus = "active";
  const rows = [child, review].map(value => ({ ...value, hasPendingInteraction: false, activity: { activeBackgroundAgentCount: 0 } }));
  harness.inspection.sdk.stub("threads.list", async (args: { originPluginId?: string }) => args.originPluginId ? rows : []);
  harness.inspection.sdk.stub("threads.getPluginMetadata", async (args: { pluginId?: string; threadId: string }) => args.pluginId === "review-implement" ? { workflowParentThreadId: args.threadId === "review" ? "plan" : thread.id } : { outcome: "done", outcomeRequestId: "turn1" });
  expect(await harness.behavior.callRpc("board_thread", { threadId: thread.id })).toMatchObject({ column: "active" });
});
