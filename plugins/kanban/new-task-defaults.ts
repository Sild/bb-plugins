import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";

const schema = z.object({
  provider: z.literal("codex"), model: z.literal("gpt-6.1-sol"), reasoning: z.literal("high"),
  environmentProvider: z.literal("project-checkout"),
}).strict();
const file = new URL(import.meta.url.endsWith("/dist/server.js") ? "../new-task-defaults.yaml" : "./new-task-defaults.yaml", import.meta.url);
const config = schema.parse(parse(readFileSync(file, "utf8")));
export const newTaskDefaults = config;
