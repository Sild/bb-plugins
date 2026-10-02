import { expect, test, vi } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { archiveScope } from "./archive";
import type { Card } from "./server";

const row = (id: string, projectId = "p1", parentThreadId: string | null = null) => ({...makeThreadResponse({id, projectId, parentThreadId}), visibility: "visible" as const, archivedAt: null, activity: {activeBackgroundAgentCount: 0}});
const card = (id: string, column: Card["column"] = "accepted"): Card => ({id, projectId: "p1", title: id, column, status: "idle", updatedAt: 1});

test("project archive pages beyond 500, includes hidden tasks, and reports individual failures", async () => {
  const rows = Array.from({length: 502}, (_,i) => ({...row(`t${i}`), visibility: i === 501 ? "hidden" as const : "visible" as const}));
  const archive = vi.fn(async ({threadId}: {threadId: string}) => {
    if (threadId === "t1") throw new Error("Host unavailable");
    return {ok: true, archivedThreadIds: [threadId]};
  });
  const {bb, harness} = createFakePluginHost({pluginId: "kanban", sdk: {threads: {
    list: async (args) => args?.archived ? [] : [...rows, row("other", "p2")].slice(args?.offset ?? 0, (args?.offset ?? 0) + (args?.limit ?? 500)), archive,
  }}});
  const result = await archiveScope(bb, {kind: "project", projectId: "p1"}, async id => card(id));
  expect(result).toMatchObject({archived: 501, failed: 1, failures: [{threadId: "t1", reason: "Host unavailable"}]});
  expect(archive).not.toHaveBeenCalledWith({threadId: "other"});
  await harness.lifecycle.dispose();
});

test("Accepted archive skips parents with nonaccepted or out-of-scope dependents and rechecks state", async () => {
  const rows = [row("parent"), row("waiting", "p1", "parent"), row("safe"), row("changed"), row("source"), {...row("hidden", "p2"), visibility: "hidden" as const, sourceThreadId: "source"}];
  const archive = vi.fn(async ({threadId}: {threadId: string}) => ({ok: true, archivedThreadIds: [threadId]}));
  const calls = new Map<string, number>();
  const getCard = async (id: string) => {
    const count = (calls.get(id) ?? 0) + 1; calls.set(id, count);
    return card(id, id === "waiting" || id === "changed" && count > 1 ? "active" : "accepted");
  };
  const {bb,harness} = createFakePluginHost({pluginId: "kanban", sdk: {threads: {list: async args => args?.archived ? [] : rows, archive}}});
  const result = await archiveScope(bb, {kind: "accepted", projectIds: ["p1"]}, getCard);
  expect(result).toMatchObject({archived: 1, failed: 3});
  expect(archive.mock.calls).toEqual([[{threadId: "safe"}]]);
  await harness.lifecycle.dispose();
});

test("refreshes dependency scopes between roots so a new cross-project dependent is not archived", async () => {
  const rows = [row("first"), row("second")];
  const archive = vi.fn(async ({threadId}: {threadId: string}) => {
    rows.push({...row("new-dependent", "p2"), lifecycleOwnerThreadId: "second"});
    return {ok: true, archivedThreadIds: [threadId]};
  });
  const {bb,harness} = createFakePluginHost({pluginId: "kanban", sdk: {threads: {list: async args => args?.archived ? [] : [...rows], archive}}});
  const result = await archiveScope(bb, {kind: "project", projectId: "p1"}, async id => card(id));
  expect(result).toMatchObject({archived: 1, failed: 1, failures: [{threadId: "second"}]});
  expect(archive.mock.calls).toEqual([[{threadId: "first"}]]);
  await harness.lifecycle.dispose();
});

test("a failed Accepted lookup does not prevent healthy candidates from being archived", async () => {
  const archive = vi.fn(async ({threadId}: {threadId: string}) => ({ok: true, archivedThreadIds: [threadId]}));
  const {bb,harness} = createFakePluginHost({pluginId: "kanban", sdk: {threads: {list: async args => args?.archived ? [] : [row("gone"), row("healthy")], archive}}});
  const result = await archiveScope(bb, {kind: "accepted", projectIds: ["p1"]}, async id => {
    if (id === "gone") throw new Error("Thread not found");
    return card(id);
  });
  expect(result).toMatchObject({archived: 1, failed: 1, failures: [{threadId: "gone", reason: "Thread not found"}]});
  expect(archive.mock.calls).toEqual([[{threadId: "healthy"}]]);
  await harness.lifecycle.dispose();
});

test.each(["waiting", "accepted"] as const)("archive checks virtual workflow dependents (%s)", async childColumn => {
  const rows = [row("root"), { ...row("review"), originPluginId: "review-implement" }];
  const archive = vi.fn(async ({ threadId }: { threadId: string }) => ({ ok: true, archivedThreadIds: [threadId] }));
  const { bb, harness } = createFakePluginHost({ pluginId: "kanban", sdk: { threads: {
    list: async args => args?.archived ? [] : rows, archive,
    getPluginMetadata: async () => ({ workflowParentThreadId: "root" }),
  } } });
  const result = await archiveScope(bb, { kind: "accepted", projectIds: ["p1"] }, async id => card(id, id === "review" ? childColumn : "accepted"));
  expect(result).toMatchObject(childColumn === "waiting" ? { archived: 0, failed: 1 } : { archived: 2, failed: 0 });
  expect(archive.mock.calls.length).toBe(childColumn === "waiting" ? 0 : 2);
  await harness.lifecycle.dispose();
});
