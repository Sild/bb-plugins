import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const mergeTargetSchema = z.object({ checkout: z.string().min(1), branch: z.string().min(1), worktree: z.string().min(1), taskBranch: z.string().min(1), taskHead: z.string().regex(/^[0-9a-f]{40,64}$/).optional() });
export type MergeTarget = z.infer<typeof mergeTargetSchema>;
const creation = z.object({ checkout: z.string().min(1), pathKey: z.string().min(1), branch: z.string().min(1) });
export const gitContract = defineRpcContract({
  worktreePath: { input: z.object({ pathKey: z.string().min(1) }), output: z.string() },
  createWorktree: { input: creation, output: z.object({ path: z.string(), baseBranch: z.string() }) },
  removeWorktree: { input: z.object({ checkout: z.string().optional(), pathKey: z.string(), branch: z.string().optional() }), output: z.boolean() },
  inspect: { input: z.object({ path: z.string().min(1) }), output: z.object({ isGit: z.boolean(), branch: z.string().nullable(), clean: z.boolean(), operation: z.boolean() }) },
  target: { input: z.object({ checkout: z.string().min(1), worktree: z.string().min(1) }), output: mergeTargetSchema },
  merge: { input: mergeTargetSchema, output: z.object({ status: z.enum(["merged", "conflicts", "blocked"]), message: z.string() }) },
  verify: { input: mergeTargetSchema, output: z.boolean() },
  cleanupBranch: { input: mergeTargetSchema, output: z.boolean() },
});
