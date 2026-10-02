import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
  experimental_scanPublicSdkOnly,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import { answerMessage, type QuestionRecord } from "./model";

const question = {
  id: "q1",
  prompt: "Which color?",
  options: [
    { value: "blue", label: "Blue" },
    { value: "green", label: "Green" },
  ],
  multiSelect: false,
  allowFreeText: true,
};
const answer = { q1: { selected: ["blue"], freeText: "Keep contrast high" } };
const thread = makeThreadResponse({ id: "th_test", title: "Example task" });
const hosts: ReturnType<typeof createFakePluginHost>[] = [];
function setup() {
  const send = vi.fn(async (_args: unknown) => ({ delivery: "sent" }));
  const host = createFakePluginHost({
    pluginId: "question-inbox",
    sdk: { threads: { get: async () => thread, send } },
  });
  hosts.push(host);
  plugin(host.bb);
  return { ...host, send };
}
async function ask(h: ReturnType<typeof setup>) {
  await h.harness.behavior.callAgentTool(
    "ask_persistent_question",
    { questions: [question] },
    { threadId: thread.id },
  );
  return (
    (await h.harness.behavior.callRpc("list", { offset: 0 })) as {
      records: QuestionRecord[];
    }
  ).records[0];
}
function native(status = "pending") {
  return {
    id: "int1",
    threadId: thread.id,
    createdAt: 1,
    status,
    statusReason: null,
    resolvedAt: null,
    turnId: "turn1",
    providerId: "codex",
    providerRequestId: "req1",
    providerThreadId: "provider-thread",
    payload: { kind: "user_question", questions: [question] },
    resolution: null,
  } as const;
}
afterEach(async () => {
  for (const h of hosts.splice(0)) await h.harness.lifecycle.dispose();
});
describe("persistent questions", () => {
  it("keeps questions and partial drafts after answer later and plugin reload", async () => {
    const h = setup();
    const r = await ask(h);
    await h.harness.behavior.callRpc("save", {
      id: r.id,
      revision: r.revision,
      draft: { q1: { selected: [], freeText: "A draft" } },
      snoozed: true,
    });
    Object.assign(h, await h.harness.lifecycle.reload(plugin));
    const result = (await h.harness.behavior.callRpc("list", {
      offset: 0,
    })) as { records: QuestionRecord[] };
    expect(result.records[0]).toMatchObject({
      snoozed: true,
      status: "open",
      draft: { q1: { freeText: "A draft" } },
    });
    expect(h.send).not.toHaveBeenCalled();
  });
  it("delivers one explicit answer with original question and rejects repeated submission", async () => {
    const h = setup();
    const r = await ask(h);
    await h.harness.behavior.callRpc("answer", {
      id: r.id,
      revision: 0,
      answers: answer,
    });
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0]?.[0]).toMatchObject({
      threadId: thread.id,
      mode: "steer-if-active",
      input: [{ text: answerMessage(r, answer) }],
    });
    await expect(
      h.harness.behavior.callRpc("answer", {
        id: r.id,
        revision: 0,
        answers: answer,
      }),
    ).rejects.toThrow();
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it("rejects stale draft writes, invalid choices, and empty answers", async () => {
    const h = setup();
    const r = await ask(h);
    await h.harness.behavior.callRpc("save", {
      id: r.id,
      revision: 0,
      draft: answer,
    });
    await expect(
      h.harness.behavior.callRpc("save", { id: r.id, revision: 0, draft: {} }),
    ).rejects.toThrow();
    await expect(
      h.harness.behavior.callRpc("answer", {
        id: r.id,
        revision: 1,
        answers: {},
      }),
    ).rejects.toThrow();
    await expect(
      h.harness.behavior.callRpc("answer", {
        id: r.id,
        revision: 1,
        answers: { q1: { selected: ["unknown"] } },
      }),
    ).rejects.toThrow();
    expect(h.send).not.toHaveBeenCalled();
  });
  it("captures native questions and routes live answers through the native resolver", async () => {
    const h = setup();
    const interaction = native();
    h.harness.inspection.sdk.stub(
      "threads.interactions.get",
      async () => interaction,
    );
    const resolve = vi.fn(async () => ({ ...interaction, status: "resolved" }));
    h.harness.inspection.sdk.stub("threads.interactions.resolve", resolve);
    await h.harness.behavior.emitThreadEvent("interaction.pending", {
      thread,
      interaction: interaction as never,
    });
    await h.harness.behavior.callRpc("answer", {
      id: "interaction:int1",
      revision: 0,
      answers: answer,
    });
    expect(resolve).toHaveBeenCalledWith({
      threadId: thread.id,
      interactionId: "int1",
      resolution: { kind: "user_answer", answers: answer },
    });
    expect(h.send).not.toHaveBeenCalled();
  });
  it("preserves expired native questions and sends late answers in their original thread", async () => {
    const h = setup();
    await h.harness.behavior.emitThreadEvent("interaction.pending", {
      thread,
      interaction: native() as never,
    });
    h.harness.inspection.sdk.stub("threads.interactions.get", async () =>
      native("interrupted"),
    );
    Object.assign(h, await h.harness.lifecycle.reload(plugin));
    h.harness.inspection.sdk.stub("threads.interactions.get", async () =>
      native("interrupted"),
    );
    await h.harness.behavior.callRpc("answer", {
      id: "interaction:int1",
      revision: 0,
      answers: answer,
    });
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it("does not resend after an ambiguous delivery or on reload", async () => {
    const h = setup();
    const r = await ask(h);
    h.send.mockRejectedValueOnce(new Error("connection lost"));
    await expect(
      h.harness.behavior.callRpc("answer", {
        id: r.id,
        revision: 0,
        answers: answer,
      }),
    ).rejects.toThrow();
    Object.assign(h, await h.harness.lifecycle.reload(plugin));
    const record = (await h.harness.behavior.callRpc("get", {
      id: r.id,
    })) as QuestionRecord;
    expect(record.status).toBe("uncertain");
    await expect(
      h.harness.behavior.callRpc("answer", {
        id: r.id,
        revision: record.revision,
        answers: answer,
      }),
    ).rejects.toThrow();
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it("deduplicates repeated questions and ignores permission interactions", async () => {
    const h = setup();
    const a = await ask(h);
    const b = await ask(h);
    expect(a.id).toBe(b.id);
    await h.harness.behavior.emitThreadEvent("interaction.pending", {
      thread,
      interaction: { ...native(), payload: { kind: "approval" } } as never,
    });
    const result = (await h.harness.behavior.callRpc("list", {
      offset: 0,
    })) as { total: number };
    expect(result.total).toBe(1);
  });
  it("closes questions when a thread is archived and rejects stale answers", async () => {
    const h = setup();
    const r = await ask(h);
    await h.harness.behavior.emitThreadEvent("thread.archived", {
      thread: makeThreadResponse({ ...thread, archivedAt: Date.now() }),
    });
    expect(
      (await h.harness.behavior.callRpc("get", { id: r.id }) as QuestionRecord)
        .status,
    ).toBe("closed");
    expect(
      (await h.harness.behavior.callRpc("list", { offset: 0 }) as { total: number })
        .total,
    ).toBe(0);
    await expect(
      h.harness.behavior.callRpc("answer", {
        id: r.id,
        revision: r.revision,
        answers: answer,
      }),
    ).rejects.toThrow();
    expect(h.send).not.toHaveBeenCalled();
  });
  it("closes questions archived before plugin reload", async () => {
    const h = setup();
    const r = await ask(h);
    h.harness.inspection.sdk.stub("threads.get", async () =>
      makeThreadResponse({ ...thread, archivedAt: Date.now() }),
    );
    const result = (await h.harness.behavior.callRpc("list", { offset: 0 })) as {
      total: number;
    };
    expect(result.total).toBe(0);
    expect(
      (await h.harness.behavior.callRpc("get", { id: r.id }) as QuestionRecord)
        .status,
    ).toBe("closed");
  });
  it("lets the user dismiss a question without sending an answer", async () => {
    const h = setup();
    const r = await ask(h);
    await h.harness.behavior.callRpc("close", {
      id: r.id,
      revision: r.revision,
    });
    expect(
      (await h.harness.behavior.callRpc("list", { offset: 0 }) as { total: number })
        .total,
    ).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
  });
  it("keeps deleted-thread questions closed when in-flight delivery fails", async () => {
    const h = setup();
    const r = await ask(h);
    let rejectSend: (error: Error) => void = () => {};
    let signalStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    h.send.mockImplementationOnce(() => {
      signalStarted();
      return new Promise((_resolve, reject) => {
        rejectSend = reject;
      });
    });
    const sending = h.harness.behavior
      .callRpc("answer", { id: r.id, revision: 0, answers: answer })
      .catch(() => {});
    await started;
    await h.harness.behavior.emitThreadEvent("thread.deleted", { thread });
    rejectSend(new Error("Thread no longer exists"));
    await sending;
    expect(
      (
        (await h.harness.behavior.callRpc("get", {
          id: r.id,
        })) as QuestionRecord
      ).status,
    ).toBe("closed");
    expect(
      (
        (await h.harness.behavior.callRpc("list", { offset: 0 })) as {
          total: number;
        }
      ).total,
    ).toBe(0);
  });
  it("retains a native question that resolved without any user answer", async () => {
    const h = setup();
    await h.harness.behavior.emitThreadEvent("interaction.pending", {
      thread,
      interaction: native() as never,
    });
    h.harness.inspection.sdk.stub("threads.interactions.get", async () => ({
      ...native("resolved"),
      resolution: { kind: "user_answer", answers: {} },
    }));
    const result = (await h.harness.behavior.callRpc("list", {
      offset: 0,
    })) as { total: number };
    expect(result.total).toBe(1);
    await h.harness.behavior.callRpc("answer", {
      id: "interaction:int1",
      revision: 0,
      answers: answer,
    });
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it("removes a question answered in the original native UI without sending again", async () => {
    const h = setup();
    await h.harness.behavior.emitThreadEvent("interaction.pending", {
      thread,
      interaction: native() as never,
    });
    h.harness.inspection.sdk.stub("threads.interactions.get", async () => ({
      ...native("resolved"),
      resolution: { kind: "user_answer", answers: answer },
    }));
    const result = (await h.harness.behavior.callRpc("list", {
      offset: 0,
    })) as { total: number };
    expect(result.total).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
  });
  it("uses only the public SDK", async () => {
    const result = await experimental_scanPublicSdkOnly(process.cwd(), {
      allow: [
        /^vitest(?:\/config)?$/,
        /^react$/,
        /^react-dom$/,
        /^sonner$/,
        /^@radix-ui\/react-dialog$/,
        /^@get-bb\/plugin-sdk\/testing(?:\/app)?$/,
        /^@testing-library\/react$/,
      ],
    });
    expect(result.violations).toEqual([]);
    expect(result.privateDependencies).toEqual([]);
  });
});

it("reformats an open question without losing drafts and rejects stale revisions or invalidated choices", async () => {
  const h = setup();
  const r = await ask(h);
  await h.harness.behavior.callRpc("save", {
    id: r.id,
    revision: 0,
    draft: answer,
    snoozed: true,
  });
  await expect(
    h.harness.behavior.callRpc("revise", {
      id: r.id,
      revision: 0,
      questions: [question],
    }),
  ).rejects.toThrow(/changed/);
  await expect(
    h.harness.behavior.callRpc("revise", {
      id: r.id,
      revision: 1,
      questions: [{ ...question, options: [] }],
    }),
  ).rejects.toThrow(/Unknown option/);
  const revised = (await h.harness.behavior.callRpc("revise", {
    id: r.id,
    revision: 1,
    questions: [{ ...question, prompt: "Choose a color" }],
  })) as QuestionRecord;
  expect(revised.draft).toEqual(answer);
  expect(revised.snoozed).toBe(true);
  expect(revised.revision).toBe(2);
  expect(h.send).not.toHaveBeenCalled();
});

it("CLI stores clickable choices and rejects malformed choices without creating a question", async () => {
  const h = setup();
  const result = await h.harness.behavior.runCli([
    "ask",
    "--thread",
    thread.id,
    "--question",
    "Choose scope",
    "--choices",
    JSON.stringify(question.options),
  ]);
  expect(result.exitCode).toBe(0);
  const malformed = await h.harness.behavior.runCli([
    "ask",
    "--thread",
    thread.id,
    "--question",
    "Invalid question",
    "--choices",
    '[{"label":"Missing value"}]',
  ]);
  expect(malformed.exitCode).toBe(1);
  const saved = (await h.harness.behavior.callRpc("list", { offset: 0 })) as {
    records: QuestionRecord[];
  };
  expect(saved.records).toHaveLength(1);
  expect(saved.records[0].questions[0].options).toEqual(question.options);
  expect(saved.records[0].draft).toEqual({});
});

it("delivers custom text as the answer and labels comments separately", async () => {
  const h = setup();
  const r = await ask(h);
  const custom = answerMessage(r, {
    q1: { selected: [], freeText: "Neither" },
  });
  expect(custom).toContain("Custom answer: Neither");
  expect(custom).not.toContain("Selected answer:");
  const annotated = answerMessage(r, answer);
  expect(annotated).toContain(
    "Selected answer: Blue\nAdditional comments: Keep contrast high",
  );
});
