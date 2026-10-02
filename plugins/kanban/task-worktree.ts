import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { inspectGit, mergeTarget } from "./git";

const exec = promisify(execFile);
async function git(checkout: string, args: string[], signal?: AbortSignal) {
  return (await exec("git", ["-C", checkout, ...args], { signal, timeout: 60_000, maxBuffer: 1024 * 1024 })).stdout.trim();
}
async function branchExists(checkout: string, branch: string, signal?: AbortSignal) {
  try { await git(checkout, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], signal); return true; }
  catch (cause) { if ((cause as { code?: unknown }).code === 1) return false; throw cause; }
}
export function taskWorktreePath(dataDir: string, pathKey: string) {
  return join(dataDir, "task-worktrees", createHash("sha256").update(pathKey).digest("hex"));
}
export async function createTaskWorktree(dataDir: string, input: { checkout: string; pathKey: string; branch: string }, signal?: AbortSignal) {
  const checkout = await realpath(input.checkout);
  const path = taskWorktreePath(dataDir, input.pathKey);
  const recordPath = `${path}.json`;
  await mkdir(join(dataDir, "task-worktrees"), { recursive: true });
  const state = await inspectGit(checkout, signal);
  if (!state.branch || state.operation) throw new Error("The project checkout must be on an active local branch with no Git operation in progress.");
  const head = await git(checkout, ["rev-parse", "HEAD"], signal);
  if ((await inspectGit(checkout, signal)).branch !== state.branch) throw new Error("The active checkout branch changed during creation. Retry.");
  await git(checkout, ["check-ref-format", "--branch", input.branch], signal);
  const record = { checkout, branch: input.branch, baseBranch: state.branch, baseHead: head, phase: "reserved" as "reserved" | "branch-created" };
  if (!await access(recordPath).then(() => true, () => false)) {
    if (await branchExists(checkout, input.branch, signal)) throw new Error("The suggested task branch already exists. Existing branches are never adopted as task-owned.");
    try { await writeFile(recordPath, JSON.stringify(record), { flag: "wx" }); }
    catch (cause) { if ((cause as { code?: string }).code !== "EEXIST") throw cause; }
  }
  const owned = JSON.parse(await readFile(recordPath, "utf8")) as typeof record;
  if (owned.checkout !== checkout || owned.branch !== input.branch) throw new Error("Worktree ownership changed. Creation stopped.");
  if (owned.phase === "reserved") {
    if (await branchExists(checkout, owned.branch, signal)) throw new Error("Task branch ownership is uncertain after interrupted creation. Branch retained for inspection.");
    await git(checkout, ["branch", owned.branch, owned.baseHead], signal);
    owned.phase = "branch-created";
    const pending = `${recordPath}.${randomUUID()}.tmp`;
    await writeFile(pending, JSON.stringify(owned)); await rename(pending, recordPath);
  } else if (owned.phase !== "branch-created") throw new Error("Invalid task worktree ownership record.");
  if (await access(path).then(() => true, () => false)) {
    const target = await mergeTarget(checkout, path, signal);
    if (target.taskBranch !== owned.branch) throw new Error("The task worktree changed branches.");
    return { path, baseBranch: owned.baseBranch };
  }
  if (await git(checkout, ["rev-parse", `refs/heads/${owned.branch}`], signal) !== owned.baseHead) throw new Error("The unattached task branch changed. Creation stopped.");
  await git(checkout, ["worktree", "add", path, owned.branch], signal);
  return { path, baseBranch: owned.baseBranch };
}
export async function removeTaskWorktree(dataDir: string, input: { checkout?: string; pathKey: string; branch?: string }, signal?: AbortSignal) {
  const path = taskWorktreePath(dataDir, input.pathKey);
  if (!await access(path).then(() => true, () => false)) return true;
  const record = JSON.parse(await readFile(`${path}.json`, "utf8")) as { checkout: string; branch: string; phase: string };
  if (record.phase !== "branch-created") throw new Error("Task branch ownership is uncertain. Worktree retained.");
  if (input.checkout && record.checkout !== await realpath(input.checkout) || input.branch && record.branch !== input.branch) throw new Error("Worktree ownership changed. Removal stopped.");
  const target = await mergeTarget(record.checkout, path, signal);
  if (target.taskBranch !== record.branch) throw new Error("Task branch changed. Worktree retained.");
  const state = await inspectGit(path, signal);
  if (!state.clean || state.operation) throw new Error("Task worktree has uncommitted changes or a Git operation. Worktree retained.");
  await git(record.checkout, ["worktree", "remove", "--force", path], signal);
  return true;
}
