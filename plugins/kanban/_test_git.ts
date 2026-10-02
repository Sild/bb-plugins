import { afterEach, expect, test, vi } from "vitest";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cleanupBranch, inspectGit, mergeTarget, mergeWorktree, verifyMerge } from "./git";
import { createTaskWorktree, removeTaskWorktree } from "./task-worktree";

const exec = promisify(execFile);
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function repository() {
  const root = await mkdtemp(join(tmpdir(), "kanban-git-")); directories.push(root);
  const checkout = join(root, "checkout"), worktree = join(root, "task");
  const git = async (path: string, ...args: string[]) => (await exec("git", ["-C", path, ...args])).stdout.trim();
  await exec("git", ["init", "-b", "custom-target", checkout]);
  await git(checkout, "config", "user.name", "Kanban Test"); await git(checkout, "config", "user.email", "test@example.invalid");
  await git(checkout, "config", "commit.gpgsign", "false");
  await writeFile(join(checkout, "file"), "base\n"); await git(checkout, "add", "file"); await git(checkout, "commit", "-m", "base");
  await git(checkout, "worktree", "add", "-b", "task", worktree);
  return { checkout, worktree, git, target: await mergeTarget(checkout, worktree) };
}
test("no-change research landing preserves destination HEAD without a merge commit", async () => {
  const { checkout, worktree, git, target } = await repository();
  const head = await git(checkout, "rev-parse", "HEAD");
  expect(await mergeWorktree(target)).toMatchObject({ status: "merged", message: "Changes already merged." });
  expect(await verifyMerge(target)).toBe(true);
  expect(await git(checkout, "rev-parse", "HEAD")).toBe(head);
  expect(await git(worktree, "rev-parse", "HEAD")).toBe(head);
});
test("lands on the captured current branch and only removes a fully merged task branch", async () => {
  const { checkout, worktree, git } = await repository();
  await writeFile(join(worktree, "new"), "task\n"); await git(worktree, "add", "new"); await git(worktree, "commit", "-m", "task");
  const target = await mergeTarget(checkout, worktree);
  expect(await mergeWorktree(target)).toMatchObject({ status: "merged" });
  expect(await verifyMerge(target)).toBe(true);
  expect(await git(checkout, "symbolic-ref", "--short", "HEAD")).toBe("custom-target");
  await git(checkout, "worktree", "remove", worktree); expect(await cleanupBranch(target)).toBe(true);
  expect(await cleanupBranch(target)).toBe(true);
});
test("conflicts leave the destination untouched and resolve safely in the task worktree", async () => {
  const { checkout, worktree, git } = await repository();
  for (const [path, content] of [[checkout, "destination\n"], [worktree, "task\n"]]) {
    await writeFile(join(path, "file"), content); await git(path, "add", "file"); await git(path, "commit", "-m", content.trim());
  }
  const target = await mergeTarget(checkout, worktree);
  const head = await git(checkout, "rev-parse", "HEAD");
  expect(await mergeWorktree(target)).toMatchObject({ status: "conflicts" });
  expect(await git(checkout, "rev-parse", "HEAD")).toBe(head); expect((await inspectGit(checkout)).operation).toBe(false);
  await expect(git(worktree, "merge", "custom-target")).rejects.toThrow();
  await writeFile(join(worktree, "file"), "destination and task\n"); await git(worktree, "add", "file"); await git(worktree, "commit", "--no-edit");
  expect(await mergeWorktree(await mergeTarget(checkout, worktree))).toMatchObject({ status: "merged" });
});
test("preserves dirty destination and task changes, rejects changed branches and unrelated repositories", async () => {
  const { checkout, worktree, git, target } = await repository();
  await writeFile(join(checkout, "unrelated"), "preserve\n"); expect(await mergeWorktree(target)).toMatchObject({ status: "blocked" });
  await rm(join(checkout, "unrelated"));
  await writeFile(join(worktree, "uncommitted"), "preserve\n"); expect(await mergeWorktree(target)).toMatchObject({ status: "blocked" });
  await rm(join(worktree, "uncommitted")); await git(checkout, "switch", "-c", "other");
  expect(await mergeWorktree(target)).toMatchObject({ status: "blocked", message: expect.stringContaining("changed branches") });
  const other = await repository(); await expect(mergeTarget(checkout, other.worktree)).rejects.toThrow("different repository");
});
test("a branch switch during merge preview cannot redirect landing", async () => {
  const { checkout, worktree, git } = await repository();
  await writeFile(join(worktree, "task-file"), "task\n"); await git(worktree, "add", "task-file"); await git(worktree, "commit", "-m", "task");
  const target = await mergeTarget(checkout, worktree);
  await git(checkout, "branch", "other"); const otherHead = await git(checkout, "rev-parse", "other");
  const executable = (await exec("which", ["git"])).stdout.trim();
  const bin = join(checkout, "..", "bin"); await mkdir(bin);
  const wrapper = join(bin, "git");
  await writeFile(wrapper, '#!/bin/sh\nif [ "$3" = "merge-tree" ]; then\n  "$KANBAN_REAL_GIT" "$@"\n  result=$?\n  "$KANBAN_REAL_GIT" -C "$KANBAN_CHECKOUT" switch other >/dev/null 2>&1\n  exit "$result"\nfi\nexec "$KANBAN_REAL_GIT" "$@"\n'); await chmod(wrapper, 0o755);
  vi.stubEnv("KANBAN_REAL_GIT", executable); vi.stubEnv("KANBAN_CHECKOUT", checkout); vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
  try {
    expect(await mergeWorktree(target)).toMatchObject({ status: "blocked", message: expect.stringContaining("changed during merge preview") });
    expect(await git(checkout, "rev-parse", "other")).toBe(otherHead);
  } finally { vi.unstubAllEnvs(); }
});
test("a shared worktree lands only the commit captured at acceptance", async () => {
  const { checkout, worktree, git } = await repository();
  await writeFile(join(worktree, "accepted"), "accepted\n"); await git(worktree, "add", "accepted"); await git(worktree, "commit", "-m", "accepted task");
  const target = await mergeTarget(checkout, worktree);
  await writeFile(join(worktree, "later"), "later\n"); await git(worktree, "add", "later"); await git(worktree, "commit", "-m", "peer task");
  expect(await mergeWorktree(target)).toMatchObject({ status: "merged" });
  expect(await verifyMerge(target)).toBe(true);
  expect(await verifyMerge({ ...target, taskHead: undefined })).toBe(false);
  expect(await git(checkout, "rev-parse", "HEAD")).toBe(target.taskHead);
  expect(await git(worktree, "rev-parse", "HEAD")).not.toBe(target.taskHead);
});
test("task creation always snapshots the active local branch, including a change after composer opened", async () => {
  const { checkout, git } = await repository();
  const originalHead = await git(checkout, "rev-parse", "HEAD");
  await git(checkout, "update-ref", "refs/remotes/origin/main", originalHead);
  await git(checkout, "switch", "-c", "current-active");
  await writeFile(join(checkout, "active-change"), "new active branch\n"); await git(checkout, "add", "active-change"); await git(checkout, "commit", "-m", "active change");
  const activeHead = await git(checkout, "rev-parse", "HEAD");
  const dataDir = join(checkout, "..", "plugin-data");
  const resource = { checkout, pathKey: "task-key", branch: "bb/current-task" };
  const created = await createTaskWorktree(dataDir, resource);
  expect(created.baseBranch).toBe("current-active"); expect(await git(created.path, "rev-parse", "HEAD")).toBe(activeHead);
  expect(await createTaskWorktree(dataDir, resource)).toEqual(created);
  await writeFile(join(created.path, "uncommitted"), "preserve\n");
  await expect(removeTaskWorktree(dataDir, resource)).rejects.toThrow("uncommitted");
  await rm(join(created.path, "uncommitted"));
  expect(await removeTaskWorktree(dataDir, { pathKey: resource.pathKey })).toBe(true);
  expect(await git(checkout, "rev-parse", resource.branch)).toBe(activeHead);
});
test("task creation never adopts a pre-existing suggested branch", async () => {
  const { checkout, git } = await repository();
  await git(checkout, "branch", "bb/existing-task");
  const head = await git(checkout, "rev-parse", "bb/existing-task");
  await expect(createTaskWorktree(join(checkout, "..", "plugin-data"), { checkout, pathKey: "collision", branch: "bb/existing-task" })).rejects.toThrow("already exists");
  expect(await git(checkout, "rev-parse", "bb/existing-task")).toBe(head);
});
