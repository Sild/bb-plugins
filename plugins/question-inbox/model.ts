import { z } from "zod";
export const questionSchema = z.object({
  id: z.string().min(1).max(200),
  prompt: z.string().trim().min(1).max(8000),
  multiSelect: z.boolean().default(false),
  allowFreeText: z.boolean().default(true),
  options: z
    .array(
      z.object({
        value: z.string().min(1).max(500),
        label: z.string().min(1).max(500),
        description: z.string().max(4000).optional(),
      }),
    )
    .max(10)
    .default([]),
});
export const questionsSchema = z
  .array(questionSchema)
  .min(1)
  .max(8)
  .superRefine((questions, ctx) => {
    if (new Set(questions.map((q) => q.id)).size !== questions.length)
      ctx.addIssue({ code: "custom", message: "Question IDs must be unique" });
    for (const q of questions)
      if (new Set(q.options.map((o) => o.value)).size !== q.options.length)
        ctx.addIssue({
          code: "custom",
          message: "Option values must be unique",
        });
  });
export const answersSchema = z.record(
  z.string(),
  z.object({
    selected: z.array(z.string()).max(10),
    freeText: z.string().max(8000).optional(),
  }),
);
export const recordSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  threadTitle: z.string(),
  createdAt: z.number(),
  interactionId: z.string().nullable(),
  source: z.enum(["native", "plugin", "persistent"]),
  questions: questionsSchema,
  draft: answersSchema,
  revision: z.number(),
  snoozed: z.boolean(),
  status: z.enum(["open", "delivering", "answered", "uncertain", "closed"]),
  error: z.string().nullable(),
});
export type QuestionRecord = z.infer<typeof recordSchema>;
export type Answers = z.infer<typeof answersSchema>;
export type Question = z.infer<typeof questionSchema>;
export function validateAnswers(
  questions: Question[],
  answers: Answers,
  complete: boolean,
) {
  if (Object.keys(answers).some((id) => !questions.some((q) => q.id === id)))
    throw new Error("Unknown question");
  for (const q of questions) {
    const a = answers[q.id];
    if (complete && (!a || (!a.selected.length && !a.freeText?.trim())))
      throw new Error("Answer each question before submitting");
    if (!a) continue;
    if (
      (!q.multiSelect && a.selected.length > 1) ||
      new Set(a.selected).size !== a.selected.length
    )
      throw new Error("Invalid selection");
    if (a.selected.some((v) => !q.options.some((o) => o.value === v)))
      throw new Error("Unknown option");
    if (!q.allowFreeText && a.freeText?.trim())
      throw new Error("This question does not accept free text");
  }
}
export function answerMessage(record: QuestionRecord, answers: Answers) {
  return `Answer to saved question ${record.id}:\n\n${record.questions
    .map((q) => {
      const a = answers[q.id];
      const labels = q.options
        .filter((o) => a.selected.includes(o.value))
        .map((o) => o.label);
      return `${q.prompt}\n${
        labels.length
          ? `Selected answer: ${labels.join("; ")}${a.freeText?.trim() ? `\nAdditional comments: ${a.freeText.trim()}` : ""}`
          : `Custom answer: ${a.freeText?.trim() ?? ""}`
      }`;
    })
    .join(
      "\n\n",
    )}\n\nApply these answers to the original task. If circumstances changed, explain the conflict before taking dependent action.`;
}
