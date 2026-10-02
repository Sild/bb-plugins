import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const schema = z.object({
  provider: z.literal("codex"), model: z.literal("gpt-6.1-sol"), reasoning: z.literal("medium"),
  projectCheckoutPaths: z.array(z.string().min(1)),
}).strict();
const file = new URL(import.meta.url.endsWith("/dist/server.js") ? "../new-task-defaults.yaml" : "./new-task-defaults.yaml", import.meta.url);
const config = schema.parse(parse(readFileSync(file, "utf8")));
export const newTaskDefaults = {
  ...config,
  projectCheckoutPaths: config.projectCheckoutPaths.map(path =>
    path.startsWith("~/") ? join(homedir(), path.slice(2)) : path,
  ),
};
