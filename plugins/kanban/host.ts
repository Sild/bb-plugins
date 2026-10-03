import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { gitContract } from "./git-contract";
import { commitStaged, stagedSnapshot, cleanupBranch, inspectGit, mergeTarget, mergeWorktree, verifyMerge } from "./git";
import { createTaskWorktree, removeTaskWorktree, taskWorktreePath } from "./task-worktree";

export default experimental_defineHostEntry({ contract: gitContract, handlers: {
  stagedSnapshot: ({ path }, { signal }) => stagedSnapshot(path, signal),
  commitStaged: ({ path, snapshot, message }, { signal }) => commitStaged(path, snapshot, message, signal),
  worktreePath: ({ pathKey }, context) => taskWorktreePath(context.experimental_paths.dataDir, pathKey),
  createWorktree: (input, context) => createTaskWorktree(context.experimental_paths.dataDir, input, context.signal),
  removeWorktree: (input, context) => removeTaskWorktree(context.experimental_paths.dataDir, input, context.signal),
  inspect: ({ path }, { signal }) => inspectGit(path, signal),
  target: ({ checkout, worktree }, { signal }) => mergeTarget(checkout, worktree, signal),
  merge: (target, { signal }) => mergeWorktree(target, signal),
  verify: (target, { signal }) => verifyMerge(target, signal),
  cleanupBranch: (target, { signal }) => cleanupBranch(target, signal),
} });
