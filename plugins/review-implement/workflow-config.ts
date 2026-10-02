import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";

const text = z.string().min(1);
const schema = z.object({
  planningModel: z.literal("gpt-6-astra"), implementationModel: z.literal("gpt-6.1-sol"), reviewModel: z.literal("gpt-6-astra"), planningReasoning: z.literal("xhigh"),
  implementationReasoning: z.literal("high"), reviewReasoning: z.literal("high"),
  maxReviewRounds: z.number().int().min(1).max(10),
  instructions: z.object({ common: text, plan: text, design: text, implementation: text, review: text, fixes: text }).strict(),
}).strict();
const file = new URL(import.meta.url.endsWith("/dist/server.js") ? "../workflow.yaml" : "./workflow.yaml", import.meta.url);
export const workflow = schema.parse(parse(readFileSync(file, "utf8")));
