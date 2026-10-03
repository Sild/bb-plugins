import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, realpath, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { MergeTarget, StagedSnapshot } from "./git-contract";

const execute = promisify(execFile);
async function git(path: string, args: string[], signal?: AbortSignal, indexFile?: string) {
  try {
    const result = await execute("git", ["-C", path, ...args], { signal, timeout: 60_000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_MERGE_AUTOEDIT: "no", ...(indexFile ? { GIT_INDEX_FILE: indexFile } : {}) } });
    return { code: 0, text: result.stdout.trim() };
  } catch (cause) {
    if (signal?.aborted) throw cause;
    const error = cause as { code?: unknown; stderr?: string; stdout?: string };
    if (typeof error.code !== "number") throw cause;
    return { code: error.code, text: (error.stderr || error.stdout || "Git command failed").trim().slice(0, 4000) };
  }
}
async function required(path: string, args: string[], signal?: AbortSignal) {
  const result = await git(path, args, signal);
  if (result.code) throw new Error(result.text);
  return result.text;
}
export async function inspectGit(path: string, signal?: AbortSignal) {
  if ((await git(path, ["rev-parse", "--is-inside-work-tree"], signal)).code) return { isGit: false, branch: null, clean: true, operation: false };
  const branch = await git(path, ["symbolic-ref", "--quiet", "--short", "HEAD"], signal);
  const operationPaths = await Promise.all(["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"].map(name => required(path, ["rev-parse", "--git-path", name], signal)));
  const exists = await Promise.all(operationPaths.map(name => access(resolve(path, name)).then(() => true, () => false)));
  return { isGit: true, branch: branch.code ? null : branch.text, clean: !(await required(path, ["status", "--porcelain", "--untracked-files=all"], signal)), operation: exists.some(Boolean) };
}
/** Capture the explicitly staged task changes without creating a commit. */
export async function stagedSnapshot(path: string, signal?: AbortSignal): Promise<StagedSnapshot> {
  const state = await inspectGit(path, signal);
  if (!state.isGit || !state.branch || state.operation) throw new Error("Finish Git operations and select a local branch before preparing acceptance.");
  const head = await required(path, ["rev-parse", "HEAD"], signal);
  const tree = await required(path, ["write-tree"], signal);
  if (tree === await required(path, ["rev-parse", "HEAD^{tree}"], signal)) throw new Error("No staged task changes. Stage only task-owned hunks before reporting Done with a commit message.");
  return { branch: state.branch, head, tree };
}
const committing = new Set<string>();
/** Accept commits the captured index tree, preserving unstaged and later staged work. */
export async function commitStaged(path: string, snapshot: StagedSnapshot, message: string, signal?: AbortSignal) {
  path = await realpath(path);
  if (committing.has(path)) throw new Error("Another task is committing in this checkout. Retry after it finishes.");
  committing.add(path);
  let directory: string | undefined;
  try {
    const state = await inspectGit(path, signal);
    if (state.branch !== snapshot.branch || state.operation) throw new Error("The branch or Git operation changed since Done. Review and report Done again.");
    const head = await required(path, ["rev-parse", "HEAD"], signal);
    // A lost RPC response can retry the exact successful commit without duplicating it.
    if (head !== snapshot.head) {
      const parent = await git(path, ["rev-parse", "HEAD^"], signal);
      if (!parent.code && parent.text === snapshot.head
        && await required(path, ["rev-parse", "HEAD^{tree}"], signal) === snapshot.tree
        && await required(path, ["log", "-1", "--format=%B"], signal) === message.trim()) return head;
      throw new Error("HEAD changed since Done. Review and report Done again.");
    }
    if (await required(path, ["write-tree"], signal) !== snapshot.tree) throw new Error("Staged changes changed since Done. Review and report Done again.");
    directory = await mkdtemp(join(tmpdir(), "kanban-accept-"));
    const indexFile = join(directory, "index");
    const read = await git(path, ["read-tree", snapshot.tree], signal, indexFile);
    if (read.code) throw new Error(read.text);
    const messageFile = join(directory, "message");
    await writeFile(messageFile, message.trim() + "\n");
    const hookHelp = await git(path, ["hook", "run", "-h"], signal);
    const hookOptions = hookHelp.text.includes("--allow-unknown-hook-name") ? ["--allow-unknown-hook-name"] : [];
    for (const [hook, ...args] of [["pre-commit"], ["prepare-commit-message", messageFile, "message"], ["commit-msg", messageFile]]) {
      const result = await git(path, ["hook", "run", "--ignore-missing", ...hookOptions, hook, "--", ...args], signal, indexFile);
      if (result.code) throw new Error(result.text);
    }
    const checked = await inspectGit(path, signal);
    if (checked.branch !== snapshot.branch || checked.operation || await required(path, ["rev-parse", "HEAD"], signal) !== snapshot.head) throw new Error("The branch or HEAD changed during commit checks. Review and report Done again.");
    const tree = await git(path, ["write-tree"], signal, indexFile);
    if (tree.code || tree.text !== snapshot.tree) throw new Error("A commit hook changed the reviewed tree. No acceptance commit was created.");
    if ((await readFile(messageFile, "utf8")).trim() !== message.trim()) throw new Error("A commit hook changed the message. Prepare the required message and report Done again.");
    const signing = await git(path, ["config", "--bool", "commit.gpgsign"], signal);
    const candidate = await git(path, ["commit-tree", snapshot.tree, "-p", snapshot.head, ...(signing.text === "true" ? ["-S"] : []), "-F", messageFile], signal, indexFile);
    if (candidate.code) throw new Error(candidate.text);
    // Publish only on the captured branch with the captured parent. Competing
    // commits fail the compare-and-swap instead of changing the reviewed scope.
    await required(path, ["update-ref", "-m", `commit: ${message.trim()}`, `refs/heads/${snapshot.branch}`, candidate.text, snapshot.head], signal);
    return candidate.text;
  } finally {
    committing.delete(path);
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
export async function mergeTarget(checkout: string, worktree: string, signal?: AbortSignal): Promise<MergeTarget> {
  checkout = await realpath(checkout); worktree = await realpath(worktree);
  if (checkout === worktree) throw new Error("The task must use a separate worktree.");
  const common = async (path: string) => realpath(resolve(path, await required(path, ["rev-parse", "--git-common-dir"], signal)));
  if (await common(checkout) !== await common(worktree)) throw new Error("The worktree belongs to a different repository.");
  const [destination, task] = await Promise.all([inspectGit(checkout, signal), inspectGit(worktree, signal)]);
  if (!destination.branch || !task.branch || destination.branch === task.branch) throw new Error("Both checkouts must be on distinct local branches.");
  return { checkout, worktree, branch: destination.branch, taskBranch: task.branch, taskHead: await required(worktree, ["rev-parse", "HEAD"], signal) };
}
// Serialize this plugin's landings by checkout. Git also locks its own refs/index.
const landings = new Set<string>();
export async function mergeWorktree(target: MergeTarget, signal?: AbortSignal) {
  const { checkout, worktree, branch, taskBranch } = target;
  if (landings.has(checkout)) return { status: "blocked" as const, message: "Another task is merging into this checkout. Retry after it finishes." };
  landings.add(checkout);
  try {
    const actual = await mergeTarget(checkout, worktree, signal);
    if (actual.branch !== branch || actual.taskBranch !== taskBranch) throw new Error("A checkout changed branches during acceptance. Restore the captured branches before retrying.");
    const [destination, task] = await Promise.all([inspectGit(checkout, signal), inspectGit(worktree, signal)]);
    if (!destination.clean || !task.clean || destination.operation || task.operation) throw new Error("Commit task changes and finish Git operations first. Preserve unrelated destination changes; do not stash or discard them automatically.");
    const taskHead = target.taskHead ?? await required(worktree, ["rev-parse", "HEAD"], signal);
    if ((await git(worktree, ["merge-base", "--is-ancestor", taskHead, "HEAD"], signal)).code) throw new Error("The accepted task commit is no longer on the task branch.");
    const destinationHead = await required(checkout, ["rev-parse", "HEAD"], signal);
    if ((await git(checkout, ["merge-base", "--is-ancestor", taskHead, "HEAD"], signal)).code === 0) return { status: "merged" as const, message: "Changes already merged." };
    const preview = await git(checkout, ["merge-tree", "--write-tree", destinationHead, taskHead], signal);
    if (preview.code === 1) return { status: "conflicts" as const, message: "Merge conflicts require agent resolution in the task worktree." };
    if (preview.code) throw new Error(preview.text);
    const beforeMerge = await inspectGit(checkout, signal);
    if (beforeMerge.branch !== branch || !beforeMerge.clean || beforeMerge.operation || await required(checkout, ["rev-parse", "HEAD"], signal) !== destinationHead) throw new Error("The destination changed during merge preview. Retry after it is stable.");
    const merge = await git(checkout, ["merge", "--no-edit", taskHead], signal);
    if (merge.code) {
      // A concurrent destination update can invalidate the conflict preview.
      // Abort only the merge we started; never abort a pre-existing operation.
      const mergeHead = await git(checkout, ["rev-parse", "--verify", "MERGE_HEAD"], signal);
      if (!mergeHead.code && mergeHead.text === taskHead) {
        await required(checkout, ["merge", "--abort"], signal);
        return { status: "conflicts" as const, message: "The destination changed after the preview. Resolve the merge in the task worktree." };
      }
      throw new Error(merge.text);
    }
    if ((await git(checkout, ["merge-base", "--is-ancestor", taskHead, "HEAD"], signal)).code) throw new Error("Could not verify the merge.");
    return { status: "merged" as const, message: "Merged into the checked-out branch." };
  } catch (cause) {
    if (signal?.aborted) throw cause;
    return { status: "blocked" as const, message: cause instanceof Error ? cause.message : String(cause) };
  } finally { landings.delete(checkout); }
}
export async function verifyMerge(target: MergeTarget, signal?: AbortSignal) {
  const destination = await inspectGit(target.checkout, signal);
  if (destination.branch !== target.branch || destination.operation) return false;
  const head = target.taskHead ? { code: 0, text: target.taskHead } : await git(target.checkout, ["rev-parse", `refs/heads/${target.taskBranch}`], signal);
  return head.code === 0 && (await git(target.checkout, ["merge-base", "--is-ancestor", head.text, "HEAD"], signal)).code === 0;
}
export async function cleanupBranch(target: MergeTarget, signal?: AbortSignal) {
  const branch = await git(target.checkout, ["show-ref", "--verify", "--quiet", `refs/heads/${target.taskBranch}`], signal);
  if (branch.code === 1) return true;
  if (!await verifyMerge(target, signal)) throw new Error("The task branch is no longer fully merged. Cleanup stopped.");
  await required(target.checkout, ["branch", "-d", "--", target.taskBranch], signal);
  return true;
}
