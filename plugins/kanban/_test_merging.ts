import { afterEach, expect, test } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

const dispose: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(dispose.splice(0).map(fn => fn())); });
function setup() {
  const thread = makeThreadResponse({ id: "t1", projectId: "p1", environmentId: "env", status: "idle" });
  thread.runtime.displayStatus = "idle";
  const environment = { id: "env", hostId: "host", projectId: "p1", isGitRepo: true, isWorktree: true, managed: true, environmentProviderId: "git-worktree", path: "/task", status: "ready", lifecycle: { phase: "active" } };
  const metadata: Record<string, unknown> = { outcome: "done", outcomeRequestId: "turn1" };
  let turn = "turn1", clean = true, mergeStatus = "merged", mergeMessage = "conflicts", failCleanup = false, verified = true, failCommit = false;
  const calls: string[] = [];
  const { bb, harness } = createFakePluginHost({ pluginId: "kanban", agentSkillIds: ["kanban-board"],
    experimental_callHostRpc: async ({ method }) => {
      calls.push(method);
      if (method === "stagedSnapshot") return { branch: "task", head: "a".repeat(40), tree: "b".repeat(40) };
      if (method === "commitStaged") { if (failCommit) throw new Error("commit failed"); clean = true; return "c".repeat(40); }
      if (method === "inspect") return { isGit: true, branch: "target", clean, operation: false };
      if (method === "target") return { checkout: "/checkout", worktree: "/task", branch: "target", taskBranch: "task", taskHead: "a".repeat(40) };
      if (method === "merge") return { status: mergeStatus, message: mergeMessage };
      if (method === "verify") return verified;
      if (method === "cleanupBranch" && failCleanup) throw new Error("cleanup failed");
      return true;
    },
    sdk: {
      projects: { get: async () => ({ id: "p1", kind: "standard", sources: [{ hostId: "host", type: "local_path", path: "/checkout", isDefault: true }] }) },
      environments: { get: async () => environment, delete: async () => { calls.push("delete"); if (thread.archivedAt === null) throw new Error("HTTP 409: Environment still has live threads"); environment.status = "destroyed"; environment.lifecycle.phase = "destroyed"; return { ok: true }; } },
      threads: {
        get: async () => thread, list: async args => args?.environmentId ? [thread] : [],
        interactions: { list: async () => [] }, events: { list: async () => [{ id: turn }] },
        getPluginMetadata: async () => metadata, updatePluginMetadata: async ({ set }) => Object.assign(metadata, set ?? {}),
        send: async () => { calls.push("send"); turn = "turn2"; thread.status = "active"; thread.runtime.displayStatus = "active"; return { ok: true }; },
      },
    },
  });
  plugin(bb); dispose.push(() => harness.lifecycle.dispose());
  return { bb, harness, thread, environment, metadata, calls, setCommitFailure: (value: boolean) => { failCommit = value; }, setVerified: (value: boolean) => { verified = value; }, setClean: (value: boolean) => { clean = value; }, setMerge: (value: string, message = "conflicts") => { mergeStatus = value; mergeMessage = message; }, setCleanupFailure: (value: boolean) => { failCleanup = value; } };
}
test("Done permits uncommitted changes without creating a commit", async () => {
  const ctx = setup(); ctx.setClean(false); delete ctx.metadata.outcome;
  expect(await ctx.harness.behavior.runCli(["report", "done"], { threadId: "t1" })).toMatchObject({ exitCode: 0 });
  expect(ctx.metadata.outcome).toBe("done"); expect(ctx.calls).toEqual(["inspect"]);
});
test("Accept merges and verifies while retaining the unarchived task workspace", async () => {
  const ctx = setup();
  expect(await ctx.harness.behavior.callRpc("board_accept", { threadId: "t1", expectedUpdatedAt: ctx.thread.updatedAt })).toMatchObject({ column: "accepted", merging: false });
  expect(ctx.calls).toEqual(["inspect", "target", "merge", "inspect", "verify"]);
  expect(await ctx.bb.storage.kv.list("merge/")).toEqual([]);
});
test("conflicts keep the task Active and resume its agent; Done retries only after idle", async () => {
  const ctx = setup(); ctx.setMerge("conflicts");
  expect(await ctx.harness.behavior.callRpc("board_accept", { threadId: "t1", expectedUpdatedAt: ctx.thread.updatedAt })).toMatchObject({ column: "active", merging: true });
  expect(ctx.calls.filter(call => call === "send")).toHaveLength(1);
  expect(ctx.calls).not.toContain("delete");
  await ctx.harness.behavior.runSchedule("continue-merges"); expect(ctx.calls.filter(call => call === "send")).toHaveLength(1);
  ctx.setMerge("merged");
  expect(await ctx.harness.behavior.runCli(["report", "done"], { threadId: "t1" })).toMatchObject({ exitCode: 0 });
  expect(ctx.calls).not.toContain("delete");
  ctx.thread.status = "idle"; ctx.thread.runtime.displayStatus = "idle";
  await ctx.harness.behavior.emitThreadEvent("thread.idle", { thread: ctx.thread, lastAssistantText: "resolved" });
  expect(await ctx.harness.behavior.callRpc("board_thread", { threadId: "t1" })).toMatchObject({ column: "accepted", merging: false });
});
test("another checkout landing waits and retries without prompting an agent", async () => {
  const ctx = setup();
  ctx.setMerge("blocked", "Another task is merging into this checkout. Retry after it finishes.");
  expect(await ctx.harness.behavior.callRpc("board_accept", { threadId: "t1", expectedUpdatedAt: ctx.thread.updatedAt })).toMatchObject({ column: "active", merging: true });
  expect(ctx.calls).toEqual(["inspect", "target", "merge"]);
  ctx.setMerge("merged");
  await ctx.harness.behavior.runSchedule("continue-merges");
  expect(await ctx.harness.behavior.callRpc("board_thread", { threadId: "t1" })).toMatchObject({ column: "accepted" });
  expect(ctx.calls.filter(call => call === "send")).toHaveLength(0);
});
test("cleanup failures retain Active recovery state and retry without merging a removed worktree", async () => {
  const ctx = setup(); ctx.thread.archivedAt = Date.now(); ctx.setCleanupFailure(true);
  expect(await ctx.harness.behavior.callRpc("board_accept", { threadId: "t1", expectedUpdatedAt: ctx.thread.updatedAt })).toMatchObject({ column: "active", merging: true, mergeError: expect.stringContaining("cleanup failed") });
  ctx.setCleanupFailure(false);
  expect(await ctx.harness.behavior.callRpc("board_retry_merge", { threadId: "t1" })).toMatchObject({ column: "accepted" });
  expect(ctx.calls.filter(call => call === "merge")).toHaveLength(1);
});
test("pending cleanup survives recovery and cannot be accepted twice", async () => {
  const ctx = setup(); ctx.thread.archivedAt = Date.now();
  ctx.harness.inspection.sdk.stub("environments.delete", async () => { ctx.environment.lifecycle.phase = "teardown"; return { ok: true }; });
  expect(await ctx.harness.behavior.callRpc("board_accept", { threadId: "t1", expectedUpdatedAt: ctx.thread.updatedAt })).toMatchObject({ column: "active", merging: true });
  await expect(ctx.harness.behavior.callRpc("board_accept", { threadId: "t1", expectedUpdatedAt: ctx.thread.updatedAt })).rejects.toThrow("Only a Done");
  ctx.environment.status = "destroyed";
  const service = ctx.harness.behavior.runService("recover-merges"); await service.done;
  expect(await ctx.harness.behavior.callRpc("board_thread", { threadId: "t1" })).toMatchObject({ column: "accepted" });
});
test("task resumption after merge postpones environment removal until idle", async () => {
  const ctx = setup();
  ctx.harness.inspection.sdk.stub("threads.get", async () => {
    if (ctx.calls.includes("verify")) { ctx.thread.runtime.displayStatus = "active"; ctx.thread.status = "active"; }
    return ctx.thread;
  });
  expect(await ctx.harness.behavior.callRpc("board_accept", { threadId: "t1", expectedUpdatedAt: ctx.thread.updatedAt })).toMatchObject({ column: "active", merging: true });
  expect(ctx.calls).not.toContain("delete");
});

test("Accept waits for a working peer, then lands while retaining a shared worktree", async () => {
  const ctx = setup();
  const peer = makeThreadResponse({ id: "t2", parentThreadId: "t1", environmentId: "env", visibility: "hidden", status: "active" });
  peer.runtime.displayStatus = "active";
  ctx.harness.inspection.sdk.stub("threads.list", async (args: { environmentId?: string } | undefined) => {
    if (!args?.environmentId) return [];
    expect(args).toMatchObject({ archived: false, includeHidden: true, environmentId: "env" });
    return [ctx.thread, peer];
  });
  expect(await ctx.harness.behavior.callRpc("board_accept", { threadId: "t1", expectedUpdatedAt: ctx.thread.updatedAt })).toMatchObject({ column: "active", merging: true });
  expect(ctx.calls).toEqual(["inspect", "target"]);
  peer.status = "idle"; peer.runtime.displayStatus = "idle";
  await ctx.harness.behavior.runSchedule("continue-merges");
  expect(await ctx.harness.behavior.callRpc("board_thread", { threadId: "t1" })).toMatchObject({ column: "accepted", merging: false });
  expect(ctx.calls).toEqual(["inspect", "target", "merge", "inspect", "verify"]);
  expect(ctx.environment.status).toBe("ready");
  expect(await ctx.bb.storage.kv.list("merge/")).toEqual([]);
});
test("Retry lands a previously blocked shared worktree without cleanup", async () => {
  const ctx = setup();
  await ctx.bb.storage.kv.set("merge/t1", { threadId: "t1", environmentId: "env", hostId: "host",
    target: { checkout: "/checkout", worktree: "/task", branch: "target", taskBranch: "task", taskHead: "a".repeat(40) },
    phase: "blocked", error: "The task environment is shared with another live thread." });
  Object.assign(ctx.metadata, { merging: true, mergeError: "shared", acceptedFor: null });
  const peer = makeThreadResponse({ id: "t2", parentThreadId: "t1", environmentId: "env" });
  ctx.harness.inspection.sdk.stub("threads.list", async (args: { environmentId?: string } | undefined) => args?.environmentId ? [ctx.thread, peer] : []);
  expect(await ctx.harness.behavior.callRpc("board_retry_merge", { threadId: "t1" })).toMatchObject({ column: "accepted", merging: false, mergeError: null });
  expect(ctx.calls).toEqual(["merge", "inspect", "verify"]);
  expect(ctx.environment.status).toBe("ready");
  expect(await ctx.bb.storage.kv.list("merge/")).toEqual([]);
});
test("a parent thread need not be accepted before its implementation lands", async () => {
  const ctx = setup();
  const peer = makeThreadResponse({ id: "t2", parentThreadId: "t1", environmentId: "env", status: "idle" });
  ctx.harness.inspection.sdk.stub("threads.list", async (args: { environmentId?: string } | undefined) => args?.environmentId ? [ctx.thread, peer] : []);
  expect(await ctx.harness.behavior.callRpc("board_accept", { threadId: "t1", expectedUpdatedAt: ctx.thread.updatedAt })).toMatchObject({ column: "accepted" });
  expect(ctx.calls).toEqual(["inspect", "target", "merge", "inspect", "verify"]);
});
test("new thread activity after Accept does not mark the newer revision accepted", async () => {
  const ctx = setup();
  const peer = makeThreadResponse({ id: "t2", parentThreadId: "t1", environmentId: "env", status: "active" });
  peer.runtime.displayStatus = "active";
  ctx.harness.inspection.sdk.stub("threads.list", async (args: { environmentId?: string } | undefined) => args?.environmentId ? [ctx.thread, peer] : []);
  const acceptedRevision = ctx.thread.updatedAt;
  expect(await ctx.harness.behavior.callRpc("board_accept", { threadId: "t1", expectedUpdatedAt: acceptedRevision })).toMatchObject({ column: "active", merging: true });
  ctx.thread.updatedAt = acceptedRevision + 1;
  peer.status = "idle"; peer.runtime.displayStatus = "idle";
  await ctx.harness.behavior.runSchedule("continue-merges");
  expect(ctx.metadata.acceptedFor).toBe(acceptedRevision);
  expect(await ctx.harness.behavior.callRpc("board_thread", { threadId: "t1" })).toMatchObject({ column: "done", merging: false });
});
test("an unrelated shared thread blocks landing even when it was accepted", async () => {
  const ctx = setup();
  const peer = makeThreadResponse({ id: "t2", environmentId: "env", status: "idle" });
  ctx.harness.inspection.sdk.stub("threads.list", async (args: { environmentId?: string } | undefined) => args?.environmentId ? [ctx.thread, peer] : []);
  expect(await ctx.harness.behavior.callRpc("board_accept", { threadId: "t1", expectedUpdatedAt: ctx.thread.updatedAt })).toMatchObject({ column: "active", merging: true, mergeError: expect.stringContaining("unrelated thread") });
  expect(ctx.calls).toEqual(["inspect", "target"]);
});
test("a worktree that becomes shared during landing is retained with its branch", async () => {
  const ctx = setup();
  ctx.harness.inspection.sdk.stub("threads.list", async (args: { environmentId?: string } | undefined) => !args?.environmentId ? [] : ctx.calls.includes("merge")
    ? [ctx.thread, makeThreadResponse({ id: "t2", environmentId: "env" })] : [ctx.thread]);
  expect(await ctx.harness.behavior.callRpc("board_accept", { threadId: "t1", expectedUpdatedAt: ctx.thread.updatedAt })).toMatchObject({ column: "accepted", merging: false });
  expect(ctx.calls).toEqual(["inspect", "target", "merge", "inspect", "verify"]);
  expect(ctx.environment.status).toBe("ready");
  expect(await ctx.bb.storage.kv.list("merge/")).toEqual([]);
});

test("recovery completes a no-change research landing blocked by live-thread deletion", async () => {
  const ctx = setup();
  await ctx.bb.storage.kv.set("merge/t1", { threadId: "t1", environmentId: "env", hostId: "host",
    target: { checkout: "/checkout", worktree: "/task", branch: "target", taskBranch: "task", taskHead: "a".repeat(40) },
    acceptedRevision: ctx.thread.updatedAt, phase: "blocked", error: "HTTP 409: Environment still has live threads" });
  Object.assign(ctx.metadata, { merging: true, mergeError: "HTTP 409: Environment still has live threads", acceptedFor: null });
  const service = ctx.harness.behavior.runService("recover-merges"); await service.done;
  expect(await ctx.harness.behavior.callRpc("board_thread", { threadId: "t1" })).toMatchObject({ column: "accepted", merging: false, mergeError: null });
  expect(ctx.calls).toEqual(["inspect", "verify"]);
  expect(ctx.environment.status).toBe("ready");
  expect(await ctx.bb.storage.kv.list("merge/")).toEqual([]);
});

test("live-thread recovery cannot accept an unverified captured commit", async () => {
  const ctx = setup(); ctx.setVerified(false);
  await ctx.bb.storage.kv.set("merge/t1", { threadId: "t1", environmentId: "env", hostId: "host",
    target: { checkout: "/checkout", worktree: "/task", branch: "target", taskBranch: "task", taskHead: "a".repeat(40) },
    phase: "blocked", error: "HTTP 409: Environment still has live threads" });
  const service = ctx.harness.behavior.runService("recover-merges"); await service.done;
  expect(await ctx.harness.behavior.callRpc("board_thread", { threadId: "t1" })).toMatchObject({ column: "active", merging: true, mergeError: expect.stringContaining("could not be verified") });
  expect(ctx.calls).toEqual(["inspect", "verify"]);
  expect(ctx.metadata.acceptedFor).toBeNull();
});

test.each([true, false])("shared landing verifies detached workflow ancestry (%s)", async related => {
  const ctx = setup();
  const peer = makeThreadResponse({ id: "review", environmentId: "env", originPluginId: "review-implement", parentThreadId: null, status: "idle" });
  ctx.harness.inspection.sdk.stub("threads.list", async (args: { environmentId?: string }) => args.environmentId ? [ctx.thread, peer] : []);
  ctx.harness.inspection.sdk.stub("threads.getPluginMetadata", async (args: { pluginId?: string }) => args.pluginId === "review-implement" ? { workflowParentThreadId: related ? "t1" : "other-root" } : ctx.metadata);
  const result = await ctx.harness.behavior.callRpc("board_accept", { threadId: "t1", expectedUpdatedAt: ctx.thread.updatedAt });
  expect(result).toMatchObject(related ? { column: "accepted" } : { column: "active", mergeError: expect.stringContaining("unrelated thread") });
  expect(ctx.calls.includes("merge")).toBe(related);
});

test("bulk Accept preserves Git validation and reports merges still in progress", async () => {
  const ctx = setup();
  const input = { projectIds: ["p1"], revisions: [{ threadId: "t1", expectedUpdatedAt: ctx.thread.updatedAt }] };
  ctx.setClean(false);
  await ctx.harness.behavior.runCli(["report", "done", "--commit-message", "task: changes"], { threadId: "t1" });
  ctx.setMerge("blocked", "Another task is merging into this checkout. Retry after it finishes.");
  expect(await ctx.harness.behavior.callRpc("board_accept_all", input)).toMatchObject({ accepted: 0, merging: 1, failed: 0 });
  ctx.setMerge("merged");
  await ctx.harness.behavior.runSchedule("continue-merges");
  expect(await ctx.harness.behavior.callRpc("board_thread", { threadId: "t1" })).toMatchObject({ column: "accepted" });
  expect(ctx.calls).not.toContain("delete");
});

test("Done prepares staged changes, then checkout Accept commits without merging", async () => {
  const ctx = setup(); ctx.environment.isWorktree = false; ctx.setClean(false);
  expect(await ctx.harness.behavior.runCli(["report", "done", "--commit-message", "task: reviewed changes"], { threadId: "t1" })).toMatchObject({ exitCode: 0 });
  expect(ctx.calls).toEqual(["inspect", "stagedSnapshot"]);
  expect(ctx.metadata.stagedAcceptance).toMatchObject({ message: "task: reviewed changes", snapshot: { branch: "task" } });
  expect(await ctx.harness.behavior.callRpc("board_accept", { threadId: "t1", expectedUpdatedAt: ctx.thread.updatedAt })).toMatchObject({ column: "accepted" });
  expect(ctx.calls).toEqual(["inspect", "stagedSnapshot", "inspect", "commitStaged"]);
});
test("worktree Accept commits prepared changes before capturing and merging the task HEAD", async () => {
  const ctx = setup(); ctx.setClean(false);
  await ctx.harness.behavior.runCli(["report", "done", "--commit-message", "task: changes"], { threadId: "t1" });
  await ctx.harness.behavior.callRpc("board_accept", { threadId: "t1", expectedUpdatedAt: ctx.thread.updatedAt });
  expect(ctx.calls.indexOf("commitStaged")).toBeLessThan(ctx.calls.indexOf("target"));
  expect(ctx.calls.indexOf("commitStaged")).toBeLessThan(ctx.calls.indexOf("merge"));
});

test("Commit leaves a worktree Done without merging; Accept commits later prepared changes", async () => {
  const ctx = setup(); ctx.setClean(false);
  await ctx.harness.behavior.runCli(["report", "done", "--commit-message", "task: first changes"], { threadId: "t1" });
  const input = { threadId: "t1", expectedUpdatedAt: ctx.thread.updatedAt };
  expect(await ctx.harness.behavior.callRpc("board_commit", input)).toMatchObject({ column: "done", hasPreparedCommit: false });
  expect(ctx.metadata.acceptedFor).toBeNull();
  expect(ctx.calls).not.toContain("target"); expect(ctx.calls).not.toContain("merge");
  expect(ctx.calls.filter(call => call === "commitStaged")).toHaveLength(1);
  // Repeated Commit and Accept after a manual commit do not create empty commits.
  await ctx.harness.behavior.callRpc("board_commit", input);
  expect(ctx.calls.filter(call => call === "commitStaged")).toHaveLength(1);
  await ctx.harness.behavior.runCli(["report", "done", "--commit-message", "task: remaining changes"], { threadId: "t1" });
  expect(await ctx.harness.behavior.callRpc("board_accept", input)).toMatchObject({ column: "accepted", hasPreparedCommit: false });
  expect(ctx.calls.filter(call => call === "commitStaged")).toHaveLength(2);
  expect(ctx.calls.indexOf("merge")).toBeGreaterThan(ctx.calls.lastIndexOf("commitStaged"));
});
test("Commit rejects changed or non-Done threads without touching Git", async () => {
  const ctx = setup();
  await expect(ctx.harness.behavior.callRpc("board_commit", { threadId: "t1", expectedUpdatedAt: ctx.thread.updatedAt - 1 })).rejects.toThrow("changed since review");
  ctx.thread.status = "active"; ctx.thread.runtime.displayStatus = "active";
  await expect(ctx.harness.behavior.callRpc("board_commit", { threadId: "t1", expectedUpdatedAt: ctx.thread.updatedAt })).rejects.toThrow("Only a Done");
  expect(ctx.calls).toEqual([]);
});
test("Commit followed by Accept with no remaining snapshot commits only once", async () => {
  const ctx = setup(); ctx.environment.isWorktree = false;
  await ctx.harness.behavior.runCli(["report", "done", "--commit-message", "task: changes"], { threadId: "t1" });
  const input = { threadId: "t1", expectedUpdatedAt: ctx.thread.updatedAt };
  await ctx.harness.behavior.callRpc("board_commit", input);
  expect(await ctx.harness.behavior.callRpc("board_accept", input)).toMatchObject({ column: "accepted" });
  expect(ctx.calls.filter(call => call === "commitStaged")).toHaveLength(1);
});

test("a failed Commit preserves the pending snapshot and keeps acceptance incomplete", async () => {
  const ctx = setup();
  await ctx.harness.behavior.runCli(["report", "done", "--commit-message", "task: changes"], { threadId: "t1" });
  ctx.setCommitFailure(true);
  const input = { threadId: "t1", expectedUpdatedAt: ctx.thread.updatedAt };
  await expect(ctx.harness.behavior.callRpc("board_commit", input)).rejects.toThrow("commit failed");
  expect(await ctx.harness.behavior.callRpc("board_thread", { threadId: "t1" })).toMatchObject({ column: "done", hasPreparedCommit: true });
  expect(ctx.calls).not.toContain("merge");
  ctx.setCommitFailure(false);
  expect(await ctx.harness.behavior.callRpc("board_commit", input)).toMatchObject({ column: "done", hasPreparedCommit: false });
});
