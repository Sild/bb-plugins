import { randomUUID } from "node:crypto";
import {
  defineRpcContract,
  cliCommand,
  defineCli,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  answersSchema,
  questionsSchema,
  recordSchema,
  validateAnswers,
  answerMessage,
  type QuestionRecord,
} from "./model";
type PendingInteraction = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["interactions"]["get"]>
>;
const target = z.object({
  id: z.string(),
  revision: z.number().int().nonnegative(),
});
export const rpcContract = defineRpcContract({
  list: {
    input: z.object({
      threadId: z.string().optional(),
      offset: z.number().int().min(0).default(0),
    }),
    output: z.object({ records: z.array(recordSchema), total: z.number() }),
  },
  revise: {
    input: target.extend({ questions: questionsSchema }),
    output: recordSchema,
  },
  get: { input: z.object({ id: z.string() }), output: recordSchema },
  save: {
    input: target.extend({
      draft: answersSchema,
      snoozed: z.boolean().optional(),
    }),
    output: recordSchema,
  },
  close: { input: target, output: recordSchema },
  answer: {
    input: target.extend({
      answers: answersSchema,
      retry: z.boolean().default(false),
    }),
    output: recordSchema,
  },
});
export default function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    "CREATE TABLE questions (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL)",
  ]);
  const changed = () => bb.realtime.publish("changed", {});
  const read = (id: string): QuestionRecord => {
    const row = db.prepare("SELECT data FROM questions WHERE id=?").get(id) as
      { data: string } | undefined;
    if (!row) throw new Error("Question not found");
    return recordSchema.parse(JSON.parse(row.data));
  };
  const write = (r: QuestionRecord) => {
    db.prepare(
      "INSERT INTO questions VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data",
    ).run(r.id, r.threadId, r.createdAt, r.status, JSON.stringify(r));
    changed();
    return r;
  };
  const rows = (threadId?: string) =>
    (
      db
        .prepare(
          `SELECT data FROM questions WHERE status IN ('open','delivering','uncertain')${threadId ? " AND thread_id=?" : ""} ORDER BY created_at DESC, id`,
        )
        .all(...(threadId ? [threadId] : [])) as { data: string }[]
    ).map((row) => recordSchema.parse(JSON.parse(row.data)));
  const editable = (id: string, revision: number) => {
    const r = read(id);
    if (r.revision !== revision)
      throw new Error(
        "This question changed in another window. Reopen it to load the saved version; your local draft is retained.",
      );
    if (r.status !== "open" && r.status !== "uncertain")
      throw new Error("This question is no longer editable");
    return r;
  };
  // Never silently resend across a crash between dispatch and acknowledgement.
  for (const r of rows())
    if (r.status === "delivering")
      write({
        ...r,
        status: "uncertain",
        error: "Delivery was interrupted. Check the thread before retrying.",
        revision: r.revision + 1,
      });
  function capture(interaction: PendingInteraction, threadTitle: string) {
    let source: QuestionRecord["source"];
    let input: unknown;
    if (interaction.payload.kind === "user_question") {
      source = "native";
      input = interaction.payload.questions;
    } else if (
      interaction.origin?.kind === "plugin" &&
      interaction.origin.pluginId === "ask-user-question" &&
      interaction.payload.kind === "plugin"
    ) {
      source = "plugin";
      input = (interaction.payload.data as { questions?: unknown } | null)
        ?.questions;
    } else return; // Never capture approvals, credentials, or arbitrary forms.
    if (interaction.status !== "pending") return;
    const questions = questionsSchema.parse(input);
    const id = `interaction:${interaction.id}`;
    if (db.prepare("SELECT 1 FROM questions WHERE id=?").get(id)) return;
    write({
      id,
      threadId: interaction.threadId,
      threadTitle,
      createdAt: interaction.createdAt,
      interactionId: interaction.id,
      source,
      questions,
      draft: {},
      revision: 0,
      snoozed: false,
      status: "open",
      error: null,
    });
  }
  function hasSubmittedAnswers(
    interaction: PendingInteraction,
    r: QuestionRecord,
  ) {
    if (
      interaction.status !== "resolved" ||
      !interaction.resolution ||
      !("kind" in interaction.resolution)
    )
      return false;
    if (interaction.resolution?.kind === "user_answer") {
      try {
        validateAnswers(r.questions, interaction.resolution.answers, true);
        return true;
      } catch {
        return false;
      }
    }
    if (interaction.resolution?.kind === "plugin_submitted") {
      const payload = interaction.resolution.description?.payload;
      const parsed = z
        .object({ answers: z.record(z.string(), z.string()) })
        .safeParse(payload);
      return (
        parsed.success &&
        r.questions.every((q) => Boolean(parsed.data.answers[q.prompt]?.trim()))
      );
    }
    return false;
  }
  async function reconcile(r: QuestionRecord) {
    if (r.status !== "open" && r.status !== "uncertain")
      return r;
    const thread = await bb.sdk.threads.get({ threadId: r.threadId });
    if (thread.archivedAt) {
      const current = read(r.id);
      if (current.status !== "open" && current.status !== "uncertain")
        return current;
      return write({
        ...current,
        status: "closed",
        revision: current.revision + 1,
      });
    }
    if (!r.interactionId) return r;
    const interaction = await bb.sdk.threads.interactions.get({
      threadId: r.threadId,
      interactionId: r.interactionId,
    });
    if (hasSubmittedAnswers(interaction, r)) {
      const current = read(r.id);
      if (current.status !== "open" && current.status !== "uncertain")
        return current;
      return write({
        ...current,
        status: "answered",
        revision: current.revision + 1,
        error: null,
      });
    }
    return read(r.id);
  }
  bb.events.on("interaction.pending", ({ thread, interaction }) => {
    if (!thread.archivedAt)
      capture(interaction, thread.title ?? "Untitled thread");
  });
  bb.events.on("thread.archived", ({ thread }) => {
    for (const r of rows(thread.id))
      write({ ...r, status: "closed", revision: r.revision + 1 });
  });
  bb.events.on("thread.deleted", ({ thread }) => {
    for (const r of rows(thread.id))
      write({ ...r, status: "closed", revision: r.revision + 1 });
  });
  bb.background.service("recover-questions", {
    async start(signal) {
      for (let offset = 0; !signal.aborted; offset += 100) {
        const threads = await bb.sdk.threads.list({
          limit: 100,
          offset,
          signal,
        });
        for (const thread of threads) {
          if (signal.aborted) return;
          if (thread.archivedAt) continue;
          for (const interaction of await bb.sdk.threads.interactions.list({
            threadId: thread.id,
            signal,
          }))
            capture(interaction, thread.title ?? "Untitled thread");
        }
        if (threads.length < 100) return;
      }
    },
  });
  bb.rpc.register(rpcContract, {
    async list({ threadId, offset }) {
      await Promise.all(
        rows(threadId)
          .slice(offset, offset + 50)
          .map((r) =>
            reconcile(r).catch((e) =>
              bb.log.warn(`Question reconciliation failed: ${String(e)}`),
            ),
          ),
      );
      const current = rows(threadId);
      return {
        records: current.slice(offset, offset + 50),
        total: current.length,
      };
    },
    revise({ id, revision, questions }) {
      const r = editable(id, revision);
      if (r.source !== "persistent" || r.status !== "open")
        throw new Error("Only open persistent questions can be revised");
      validateAnswers(questions, r.draft, false);
      return write({ ...r, questions, revision: r.revision + 1 });
    },
    get: ({ id }) => reconcile(read(id)),
    save({ id, revision, draft, snoozed }) {
      const r = editable(id, revision);
      validateAnswers(r.questions, draft, false);
      return write({
        ...r,
        draft,
        snoozed: snoozed ?? r.snoozed,
        revision: r.revision + 1,
      });
    },
    close({ id, revision }) {
      const r = editable(id, revision);
      return write({ ...r, status: "closed", revision: r.revision + 1 });
    },
    async answer({ id, revision, answers, retry }) {
      await reconcile(read(id));
      let r = editable(id, revision);
      validateAnswers(r.questions, answers, true);
      if (r.status === "uncertain" && !retry)
        throw new Error(
          "Check the thread before explicitly retrying an uncertain delivery",
        );
      r = write({
        ...r,
        draft: answers,
        status: "delivering",
        error: null,
        revision: r.revision + 1,
      });
      const finish = (
        status: QuestionRecord["status"],
        error: string | null = null,
      ) => {
        const latest = read(r.id);
        if (latest.status !== "delivering" || latest.revision !== r.revision)
          return latest;
        return write({
          ...latest,
          status,
          error,
          revision: latest.revision + 1,
        });
      };
      let dispatchAttempted = false;
      try {
        if (r.interactionId) {
          const interaction = await bb.sdk.threads.interactions.get({
            threadId: r.threadId,
            interactionId: r.interactionId,
          });
          if (hasSubmittedAnswers(interaction, r)) return finish("answered");
          if (interaction.status === "resolving")
            throw new Error(
              "An answer is already being processed. Try again after it finishes.",
            );
          if (interaction.status === "pending") {
            dispatchAttempted = true;
            if (r.source === "native")
              await bb.sdk.threads.interactions.resolve({
                threadId: r.threadId,
                interactionId: r.interactionId,
                resolution: { kind: "user_answer", answers },
              });
            else
              await bb.sdk.threads.interactions.respond({
                threadId: r.threadId,
                interactionId: r.interactionId,
                value: { answers },
              });
            return finish("answered");
          }
        }
        dispatchAttempted = true;
        await bb.sdk.threads.send({
          threadId: r.threadId,
          mode: "steer-if-active",
          input: [
            { type: "text", text: answerMessage(r, answers), mentions: [] },
          ],
        });
        return finish("answered");
      } catch (e) {
        finish(
          dispatchAttempted ? "uncertain" : "open",
          `${dispatchAttempted ? "Delivery could not be confirmed. Check the thread before retrying. " : ""}${String(e)}`,
        );
        throw e;
      }
    },
  });
  async function ask(threadId: string, questions: QuestionRecord["questions"]) {
    questions = questionsSchema.parse(questions);
    const thread = await bb.sdk.threads.get({ threadId });
    const existing = rows(threadId).find(
      (r) =>
        r.source === "persistent" &&
        JSON.stringify(r.questions) === JSON.stringify(questions),
    );
    const r =
      existing ??
      write({
        id: randomUUID(),
        threadId,
        threadTitle: thread.title ?? "Untitled thread",
        createdAt: Date.now(),
        interactionId: null,
        source: "persistent",
        questions,
        draft: {},
        revision: 0,
        snoozed: false,
        status: "open",
        error: null,
      });
    return JSON.stringify({
      id: r.id,
      status: "awaiting_user",
      instruction:
        "The question is saved and shown in a popup. Continue independent work. Do not decide or perform answer-dependent work until the user answers. If blocked, end your turn as waiting; the answer will resume this thread. Time passing is never an answer.",
    });
  }
  bb.agents.registerTool({
    name: "ask_persistent_question",
    description:
      "Ask the user for missing information or a consequential choice in a persistent popup. Questions never expire; custom text and optional choices are supported. Returns immediately with pending status, not the user's answer. Never use for permission or credentials.",
    instructions:
      "For questions that need the user's answer, prefer ask_persistent_question over plain-text questions or transient question tools. Continue independent work, but never assume an answer or perform dependent work. When no independent work remains, report waiting and end the turn; the user's answer resumes it. Put choices in structured options, never a numbered paragraph. Do not repeat the question in chat after posting it. Do not re-ask an existing unanswered question. Permission and credential requests must use their dedicated flows.",
    parameters: z.object({ questions: questionsSchema }),
    execute: ({ questions }, ctx) => ask(ctx.threadId, questions),
  });
  bb.cli.register(
    defineCli({
      name: "questions",
      summary: "Ask persistent questions and inspect unanswered questions",
      commands: {
        ask: cliCommand({
          summary: "Show a persistent question",
          options: {
            question: {
              type: "string",
              required: true,
              description: "Question text",
            },
            choices: {
              type: "string",
              description:
                'JSON array of choices: [{"value":"a","label":"Choice","description":"Details"}]',
            },
            thread: {
              type: "string",
              description: "Thread ID (defaults to current thread)",
            },
          },
          async run(input, ctx) {
            const threadId = input.options.thread ?? ctx.threadId;
            if (!threadId) throw new Error("Pass --thread <thread-id>");
            return {
              exitCode: 0,
              stdout: await ask(threadId, [
                {
                  id: "answer",
                  prompt: input.options.question,
                  multiSelect: false,
                  allowFreeText: true,
                  options: input.options.choices
                    ? JSON.parse(input.options.choices)
                    : [],
                },
              ]),
            };
          },
        }),
        list: cliCommand({
          summary: "List unanswered question summaries",
          options: {},
          run(_input, ctx) {
            return {
              exitCode: 0,
              stdout: JSON.stringify(
                rows(ctx.threadId).map((r) => ({
                  id: r.id,
                  threadId: r.threadId,
                  status: r.status,
                  questions: r.questions.map((q) => q.prompt),
                })),
              ),
            };
          },
        }),
      },
    }),
  );
}
