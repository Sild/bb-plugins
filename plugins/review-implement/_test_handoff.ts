import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(disposers.splice(0).map(dispose => dispose())); });
async function setup({ quota = 2, provider = "codex" }: { quota?: number | null; provider?: string } = {}) {
  const root = makeThreadResponse({ id: "root", providerId: provider, projectId: "project", environmentId: "environment", title: "Project", status: "idle" });
  const threads = new Map([[root.id, root]]);
  const outputs = new Map<string, string>();
  const columns = new Map<string, string>();
  const spawned: Array<Record<string, unknown>> = [];
  const sent: Array<{ threadId: string; text: string }> = [];
  const accepted: string[] = [];
  const links = new Map<string, string>();
  let usage = quota, acceptanceFails = false, requestId = "artifact-turn";
  const { bb, harness } = createFakePluginHost({ pluginId: "review-implement", sdk: {
    environments: { get: async () => ({ hostId: "host" }) },
    system: { usageLimits: async () => ({ "claude-code": usage === null ? { status: "error", message: "unavailable" } : { status: "ok", windows: [{ usedPercent: usage }] } }) },
    plugins: { callRpc: async (args: { method: string; input: { threadId: string; reviewThreadId?: string } }) => {
      if (args.method === "board_thread") return { id: args.input.threadId, column: columns.get(args.input.threadId) ?? "waiting" };
      if (acceptanceFails) throw new Error("acceptance temporarily unavailable");
      if (args.method === "board_accept_plan") expect(accepted).toContain(args.input.reviewThreadId);
      if (!accepted.includes(args.input.threadId)) accepted.push(args.input.threadId);
      columns.set(args.input.threadId, "accepted");
      return { id: args.input.threadId, column: "accepted" };
    } },
    threads: {
      getPluginMetadata: async ({ threadId }: { threadId: string }) => ({ workflowParentThreadId: links.get(threadId) }),
      updatePluginMetadata: async ({ threadId, set }: { threadId: string; set: { workflowParentThreadId: string } }) => { links.set(threadId, set.workflowParentThreadId); return set; },
      events: { list: async () => [{ id: requestId }] },
      get: async ({ threadId }: { threadId: string }) => { const thread = threads.get(threadId); if (!thread) throw Object.assign(new Error("missing thread"), { code: "thread_not_found" }); return thread; },
      spawn: async (args: Record<string, unknown>) => {
        spawned.push(args);
        const id = `child-${spawned.length}`;
        const thread = makeThreadResponse({ id, providerId: args.providerId as string, projectId: "project", environmentId: "environment", parentThreadId: args.parentThreadId as string ?? null, originKind: args.originKind as "fork" ?? null, title: args.title as string, status: "active" });
        threads.set(id, thread); return thread;
      },
      update: async ({ threadId, parentThreadId }: { threadId: string; parentThreadId: string | null }) => {
        const thread = threads.get(threadId)!; thread.parentThreadId = parentThreadId; return thread;
      },
      output: async ({ threadId }: { threadId: string }) => ({ output: outputs.get(threadId) ?? null }),
      send: async (args: { threadId: string; input: Array<{ text: string }> }) => {
        sent.push({ threadId: args.threadId, text: args.input[0].text });
        columns.set(args.threadId, "active"); threads.get(args.threadId)!.status = "active"; return {};
      },
      timeline: async (args: { beforeAnchorId?: string }) => args.beforeAnchorId
        ? { rows: [{ text: "old user decision" }], timelinePage: { hasOlderRows: false, olderCursor: null } }
        : { rows: [{ text: "new requirement", nestedRows: [{ text: "tool context" }] }], timelinePage: { hasOlderRows: true, olderCursor: { anchorId: "older", anchorSeq: 1 } } },
    },
  } });
  await plugin(bb); disposers.push(() => harness.lifecycle.dispose());
  async function idle(id: string, output: string, done = true) {
    const thread = threads.get(id)!; thread.status = "idle";
    outputs.set(id, output); columns.set(id, done ? "done" : "waiting");
    await harness.behavior.emitThreadEvent("thread.idle", { thread, lastAssistantText: output });
  }
  return { bb, harness, threads, spawned, sent, accepted, links, idle, setRequestId: (value: string) => { requestId = value; }, setQuota: (value: number | null) => { usage = value; }, setAcceptanceFails: (value: boolean) => { acceptanceFails = value; } };
}

describe("reviewed artifact workflows", () => {
  it.each([
    { from: "design", to: "plan", prefix: "[PLAN]" },
    { from: "plan", to: "implementation", prefix: "[</>]" },
    { from: "plan", to: "design", prefix: "[DESIGN]" },
  ] as const)("keeps one stage prefix when starting $to from $from", async ({ from, to, prefix }) => {
    const ctx = await setup();
    await ctx.harness.behavior.callRpc("startPlan", { threadId: "root", kind: from });
    if (to === "implementation") await ctx.harness.behavior.callRpc("startImplementation", { threadId: "child-1" });
    else await ctx.harness.behavior.callRpc("startPlan", { threadId: "child-1", kind: to });
    expect(ctx.spawned[1].title).toBe(`${prefix} Project`);
    await ctx.idle("child-2", "Completed artifact");
    expect(ctx.spawned[2].title).toBe(`[👁]${prefix} Project`);
  });
  it("replaces stacked workflow markers while preserving unrelated title tags", async () => {
    const ctx = await setup();
    ctx.threads.get("root")!.title = "[👁][PLAN] [BE-123] Project";
    await ctx.harness.behavior.callRpc("startImplementation", { threadId: "root" });
    expect(ctx.spawned[0].title).toBe("[</>] [BE-123] Project");
    await ctx.idle("child-1", "Completed artifact");
    expect(ctx.spawned[1].title).toBe("[👁][</>] [BE-123] Project");
  });
  it.each(["plan", "design", "implementation"] as const)("names %s reviews after their producer even when the main thread is renamed", async kind => {
    const ctx = await setup();
    if (kind === "implementation") await ctx.harness.behavior.callRpc("startImplementation", { threadId: "root" });
    else await ctx.harness.behavior.callRpc("startPlan", { threadId: "root", kind });
    ctx.threads.get("root")!.title = "Renamed main thread";
    await ctx.idle("child-1", "Completed artifact");
    expect(ctx.spawned[1].title).toBe(`[👁]${ctx.spawned[0].title}`);
  });

  it.each(["plan", "design"] as const)("forks full context for %s at xhigh, reviews with Claude, returns the whole artifact and accepts both children", async kind => {
    const ctx = await setup();
    await ctx.harness.behavior.callRpc("startPlan", { threadId: "root", kind, instruction: "Newest request" });
    expect(ctx.spawned[0]).toMatchObject({ providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "xhigh", sourceThreadId: "root", originKind: "fork", title: `[${kind.toUpperCase()}] Project` });
    expect(ctx.spawned[0].prompt).toContain("Newest request");
    expect(ctx.links.get("child-1")).toBe("root");
    expect(ctx.threads.get("child-1")!.parentThreadId).toBeNull();
    const artifact = "complete artifact ".repeat(2000);
    await ctx.idle("child-1", artifact);
    expect(ctx.spawned[1]).toMatchObject({ providerId: "claude-code", permissionMode: "auto", title: `[👁][${kind.toUpperCase()}] Project` });
    expect(ctx.spawned[1]).not.toHaveProperty("model");
    expect(ctx.spawned[1]).not.toHaveProperty("parentThreadId");
    expect(ctx.links.get("child-2")).toBe("child-1");
    expect(ctx.threads.get("child-2")!.parentThreadId).toBeNull();
    expect(ctx.sent).toHaveLength(0);
    await ctx.idle("child-2", "No material findings\nREVIEW_STATUS: approved");
    expect(ctx.sent).toHaveLength(1);
    expect(ctx.sent[0].threadId).toBe("root"); expect(ctx.sent[0].text).toContain(artifact);
    expect(ctx.accepted).toEqual(["child-2", "child-1"]);
    expect(ctx.threads.get("child-2")!.parentThreadId).toBeNull();
    // Duplicate idle events cannot repeat delivery or acceptance.
    await ctx.idle("child-2", "No material findings\nREVIEW_STATUS: approved");
    expect(ctx.sent).toHaveLength(1);
  });
  it.each([100, null])("uses Codex High when Claude quota is %s", async quota => {
    const ctx = await setup({ quota });
    await ctx.harness.behavior.callRpc("startImplementation", { threadId: "root" });
    expect(ctx.spawned[0]).toMatchObject({ providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "high", title: "[</>] Project" });
    await ctx.idle("child-1", "Implementation at commit abc");
    expect(ctx.spawned[1]).toMatchObject({ providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "high", title: "[👁][</>] Project" });
    await ctx.idle("child-2", "No material findings\nREVIEW_STATUS: approved");
    expect(ctx.accepted).toEqual(["child-2"]); // Implementation still requires user acceptance.
  });
  it("does not review or accept question pauses; resumes after the answer and Done", async () => {
    const ctx = await setup();
    await ctx.harness.behavior.callRpc("startPlan", { threadId: "root", kind: "design" });
    await ctx.idle("child-1", "Which platform?", false);
    expect(ctx.spawned).toHaveLength(1); expect(ctx.sent).toHaveLength(0); expect(ctx.accepted).toHaveLength(0);
    await ctx.idle("child-1", "Design completed");
    await ctx.idle("child-2", "Need more evidence", false);
    expect(ctx.sent).toHaveLength(0); expect(ctx.accepted).toHaveLength(0);
    await ctx.idle("child-2", "Evidence verified\nREVIEW_STATUS: approved");
    expect(ctx.accepted).toEqual(["child-2", "child-1"]);
  });
  it("returns findings to the producer, then independently reviews its fixed artifact before notifying the root", async () => {
    const ctx = await setup();
    await ctx.harness.behavior.callRpc("startImplementation", { threadId: "root" });
    await ctx.idle("child-1", "Initial commit abc");
    await ctx.idle("child-2", "Fix issue A\nREVIEW_STATUS: changes_requested");
    expect(ctx.sent.map(value => value.threadId)).toEqual(["child-1"]);
    expect(ctx.accepted).toEqual(["child-2"]);
    await ctx.idle("child-1", "Fixed at commit def");
    expect(ctx.spawned).toHaveLength(3);
    expect(ctx.spawned[2].title).toBe("[👁][</>] Project");
    await ctx.idle("child-3", "Commit def verified\nREVIEW_STATUS: approved");
    expect(ctx.sent.map(value => value.threadId)).toEqual(["child-1", "root"]);
    expect(ctx.sent[1].text).toContain("Fixed at commit def");
    expect(ctx.accepted).toEqual(["child-2", "child-3"]);
  });
  it("retries acceptance after a delivered handoff without resending the artifact", async () => {
    const ctx = await setup();
    await ctx.harness.behavior.callRpc("startPlan", { threadId: "root", kind: "plan" });
    await ctx.idle("child-1", "Plan"); ctx.setAcceptanceFails(true);
    await ctx.idle("child-2", "Approved\nREVIEW_STATUS: approved");
    expect(ctx.sent).toHaveLength(1); expect(ctx.accepted).toHaveLength(0);
    ctx.setAcceptanceFails(false);
    await ctx.idle("child-2", "Approved\nREVIEW_STATUS: approved");
    expect(ctx.sent).toHaveLength(1); expect(ctx.accepted).toEqual(["child-2", "child-1"]);
  });
  it("falls back if Claude becomes exhausted after preflight", async () => {
    const ctx = await setup();
    await ctx.harness.behavior.callRpc("startPlan", { threadId: "root", kind: "plan" }); await ctx.idle("child-1", "Plan");
    ctx.setQuota(100); ctx.threads.get("child-2")!.status = "error";
    await ctx.harness.behavior.emitThreadEvent("thread.failed", { thread: ctx.threads.get("child-2")!, error: "Quota exhausted" });
    expect(ctx.spawned[2]).toMatchObject({ providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "high", title: "[👁][PLAN] Project" });
    expect(ctx.sent).toHaveLength(0);
    expect(ctx.threads.get("child-2")!.parentThreadId).toBeNull();
  });
  it("transfers every source timeline page when planning from Claude", async () => {
    const ctx = await setup({ provider: "claude-code" });
    await ctx.harness.behavior.callRpc("startPlan", { threadId: "root", kind: "plan" });
    const prompt = ctx.spawned[0].prompt as string;
    expect(prompt).toContain("old user decision"); expect(prompt).toContain("new requirement"); expect(prompt).toContain("tool context");
    expect(prompt.indexOf("old user decision")).toBeLessThan(prompt.indexOf("new requirement"));
    expect(ctx.spawned[0]).not.toHaveProperty("parentThreadId");
    expect(ctx.links.get("child-1")).toBe("root");
    expect(ctx.threads.get("child-1")!.parentThreadId).toBeNull();
    expect(ctx.spawned[0]).not.toHaveProperty("originKind");
  });
  it("does not call an ambiguous review approved", async () => {
    const ctx = await setup();
    await ctx.harness.behavior.callRpc("startPlan", { threadId: "root", kind: "plan" }); await ctx.idle("child-1", "Plan");
    await ctx.idle("child-2", "Looks okay");
    expect(ctx.accepted).toHaveLength(0); expect(ctx.sent[0].text).toContain("could not complete");
  });
  it("bounds review rounds and sends an unresolved blocker instead of approval", async () => {
    const ctx = await setup();
    await ctx.harness.behavior.callRpc("startPlan", { threadId: "root", kind: "plan" });
    for (let round = 1; round <= 3; round++) {
      await ctx.idle("child-1", `Revision ${round}`);
      await ctx.idle(`child-${round + 1}`, "Material issue\nREVIEW_STATUS: changes_requested");
    }
    expect(ctx.spawned).toHaveLength(4); expect(ctx.accepted).toEqual(["child-2", "child-3", "child-4"]);
    expect(ctx.sent.at(-1)!.threadId).toBe("root"); expect(ctx.sent.at(-1)!.text).toContain("has not been approved");
  });
});

it("acceptance retries never accept a plan revised after the delivered review", async () => {
  const ctx = await setup();
  await ctx.harness.behavior.callRpc("startPlan", { threadId: "root", kind: "plan" });
  await ctx.idle("child-1", "Plan A"); ctx.setAcceptanceFails(true);
  await ctx.idle("child-2", "Approved A\nREVIEW_STATUS: approved");
  ctx.setRequestId("revision-b"); await ctx.idle("child-1", "Plan B");
  ctx.setAcceptanceFails(false); await ctx.idle("child-2", "Approved A\nREVIEW_STATUS: approved");
  expect(ctx.accepted).not.toContain("child-1");
  expect((await ctx.bb.storage.kv.get<{phase: string}>("job:child-1"))?.phase).toBe("working");
});
it("a completed pre-upgrade manual review still delivers feedback and is accepted", async () => {
  const ctx = await setup();
  await ctx.harness.behavior.callRpc("startPlan", { threadId: "root", kind: "plan" });
  ctx.threads.get("child-1")!.title = "[👁] Project";
  await ctx.bb.storage.kv.set("job:child-1", { kind: "review", sourceThreadId: "root", phase: "working" });
  await ctx.idle("child-1", "Legacy review findings");
  expect(ctx.sent[0]?.text).toContain("Legacy review findings");
  expect(ctx.accepted).toEqual(["child-1"]);
});

it.each(["implementation", "implementation-fixes"])("pre-upgrade %s jobs enter the bounded review flow", async kind => {
  const ctx = await setup();
  await ctx.harness.behavior.callRpc("startImplementation", { threadId: "root" });
  await ctx.bb.storage.kv.set("job:child-1", { kind, sourceThreadId: "root", phase: "working" });
  await ctx.idle("child-1", "Legacy code");
  expect(ctx.spawned[1]).toMatchObject({ providerId: "claude-code" });
  expect((await ctx.bb.storage.kv.get<{reviewRound: number}>("job:child-1"))?.reviewRound).toBe(1);
});
it("pre-upgrade implementation reviews deliver findings, then require a new explicit-verdict review", async () => {
  const ctx = await setup();
  await ctx.harness.behavior.callRpc("startImplementation", { threadId: "root" });
  await ctx.idle("child-1", "Legacy code");
  await ctx.bb.storage.kv.set("job:child-2", { kind: "implementation-review", sourceThreadId: "root", implementationThreadId: "child-1", phase: "working" });
  await ctx.idle("child-2", "Legacy findings without a verdict");
  expect(ctx.accepted).toEqual(["child-2"]);
  expect(ctx.sent.map(item => item.threadId)).toEqual(["child-1"]);
  await ctx.idle("child-1", "Legacy findings resolved");
  expect(ctx.spawned).toHaveLength(3);
  await ctx.idle("child-3", "Verified\nREVIEW_STATUS: approved");
  expect(ctx.sent.at(-1)!.threadId).toBe("root");
});

it("keeps cross-provider workflow ancestry in metadata through corrections", async () => {
  const ctx = await setup({ provider: "claude-code" });
  await ctx.harness.behavior.callRpc("startPlan", { threadId: "root", kind: "plan" });
  await ctx.idle("child-1", "Initial plan");
  expect(ctx.threads.get("child-1")!.parentThreadId).toBeNull();
  expect(ctx.threads.get("child-2")!.parentThreadId).toBeNull();
  await ctx.idle("child-2", "Fix schema\nREVIEW_STATUS: changes_requested");
  expect(ctx.threads.get("child-1")!.parentThreadId).toBeNull();
  expect(ctx.threads.get("child-2")!.parentThreadId).toBeNull();
  await ctx.idle("child-1", "Complete corrected plan");
  expect(ctx.threads.get("child-3")!.parentThreadId).toBeNull();
  await ctx.idle("child-3", "Verified\nREVIEW_STATUS: approved");
  expect(ctx.threads.get("child-1")!.parentThreadId).toBeNull();
  expect(ctx.threads.get("child-3")!.parentThreadId).toBeNull();
  expect(ctx.sent.map(item => item.threadId)).toEqual(["child-1", "root"]);
  expect(ctx.accepted).toEqual(["child-2", "child-3", "child-1"]);
  expect(Object.fromEntries(ctx.links)).toEqual({ "child-1": "root", "child-2": "child-1", "child-3": "child-1" });
});

it("ignores failed legacy handoffs without looking up deleted threads", async () => {
  const ctx = await setup();
  await ctx.harness.behavior.callRpc("startPlan", { threadId: "root", kind: "plan" });
  const child = ctx.threads.get("child-1")!;
  await ctx.bb.storage.kv.set("job:child-1", { kind: "review", sourceThreadId: "root", phase: "failed" });
  ctx.threads.delete("child-1");
  await ctx.harness.behavior.emitThreadEvent("thread.idle", { thread: child, lastAssistantText: "old failed handoff" });
  expect(ctx.sent).toHaveLength(0);
  expect(ctx.accepted).toHaveLength(0);
});

it("repairs pre-upgrade native parent links before continuing a review", async () => {
  const ctx = await setup();
  await ctx.harness.behavior.callRpc("startPlan", { threadId: "root", kind: "plan" });
  await ctx.idle("child-1", "Plan");
  ctx.threads.get("child-2")!.parentThreadId = "child-1";
  const replacement = await ctx.harness.lifecycle.reload(plugin);
  disposers.push(() => replacement.harness.lifecycle.dispose());
  const child = ctx.threads.get("child-2")!; child.status = "idle";
  await replacement.harness.behavior.emitThreadEvent("thread.idle", { thread: child, lastAssistantText: "Question awaiting answer" });
  expect(ctx.threads.get("child-2")!.parentThreadId).toBeNull();
  expect(ctx.sent).toHaveLength(0);
});

it("retires a deleted working handoff while recovery continues", async () => {
  const ctx = await setup();
  await ctx.bb.storage.kv.set("job:deleted", { kind: "review", sourceThreadId: "root", phase: "working" });
  await ctx.bb.storage.kv.set("job-ids", ["deleted"]);
  const service = ctx.harness.behavior.runService("recover-handoffs");
  for (let attempt = 0; attempt < 30; attempt++) {
    if ((await ctx.bb.storage.kv.get<{phase: string}>("job:deleted"))?.phase === "failed") break;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  expect((await ctx.bb.storage.kv.get<{phase: string}>("job:deleted"))?.phase).toBe("failed");
  service.controller.abort(); await service.done;
});

it("reload keeps completed workflow links without changing the accepted revision or redelivering", async () => {
  const ctx = await setup();
  await ctx.harness.behavior.callRpc("startPlan", { threadId: "root", kind: "plan" });
  await ctx.idle("child-1", "Complete plan");
  await ctx.idle("child-2", "Approved\nREVIEW_STATUS: approved");
  const replacement = await ctx.harness.lifecycle.reload(plugin);
  disposers.push(() => replacement.harness.lifecycle.dispose());
  await replacement.harness.behavior.emitThreadEvent("thread.idle", { thread: ctx.threads.get("child-2")!, lastAssistantText: "Approved\nREVIEW_STATUS: approved" });
  expect(replacement.harness.inspection.sdk.callsTo("threads.updatePluginMetadata").length).toBe(0);
  expect(ctx.sent).toHaveLength(1); expect(ctx.accepted).toEqual(["child-2", "child-1"]);
});
