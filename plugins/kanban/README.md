# BB Kanban

Visible, unarchived BB threads appear as cards across **Backlog**, **Waiting**, **Active**, **Done**, and **Accepted**. Status follows BB agent activity automatically. Pending threads are Backlog; running threads and idle parents with active subagents are Active; pending user input is Waiting; other idle threads are Done only after the agent reports completion for the current turn. Unreported idle work stays Waiting. Host reconnection remains Active; errors requiring user attention are Waiting.

Review Done work using **Accept** in the thread composer. Acceptance applies to the current revision and expires after further activity. Cards open native threads and have no manual status controls.

Each project with cards has a horizontal row; empty sections are hidden. The project filter supports multiselect, folder selection, search, Select all, and Clear. The optional Project Groups integration follows sidebar folders and pins, with an explicit fallback warning if unavailable. Up to 500 visible threads are queried within selected projects. Lifecycle events, reconnect, and window focus refresh the board.

**Archive accepted** is the icon immediately after the Accepted counter, with a hover/focus tooltip; it targets selected projects. The archive menu
just before each project’s folder label offers Accepted-only or all-project archiving. Each action confirms its scope
and reports partial failures. Roots with dependent tasks outside the selection are
skipped; project-wide archiving can stop running work and invoke BB environment cleanup.

Enable **Show archive** to add an **Archived** column. Choose 1d, 1w, 2w, 1 month,
3 months, 6 months, or 1 year (rolling day ranges). Cards are filtered and sorted by
last acceptance time, newest first. Acceptance timestamps are recorded from this
version onward; undated historical archives remain visible after dated cards, with a notice that the time filter cannot apply to them.

Enter retains native submission. Save draft is available directly in the composer; the saved queued message remains held while Kanban is running and can resume if the plugin is disabled. Shift+Enter has no override.

## Install and validate

```sh
npm install --include=dev
npm run typecheck
npm test
bb plugin build
bb plugin install .
```

## Commands

```sh
bb kanban list [--project <id>] [--project <another-id>] [--json]
```

Agents use `bb kanban report done` before a completed handoff and `bb kanban report waiting` before yielding for required input. Reports expire on a new turn; runtime activity and pending input still take precedence. Existing sessions need refreshed skill instructions to report completion. The old manual `move` command is removed. See [the board specification](docs/specs/board.md) for runtime mappings and limitations.

Git project tasks in the native composer default to **Project checkout** on the current active local branch with GPT-6.1-Sol High. No branch or worktree is created by default; **Task worktree** remains available when explicitly selected. Branch from is a read-only display of the active local checkout branch; the actual base is read again when the worktree is created. Validate and stage task-owned hunks, then report Done with `--commit-message "scope: summary"`; leave changes uncommitted for review. Accept commits the captured staged snapshot. Accept merges the worktree into the checkout branch, resumes the task agent for conflicts, and records acceptance after verifying the landing. No-change research needs no merge commit. The worktree and branch remain while the thread is unarchived; archiving retires the workspace through BB. The task stays Active with **Merging...** until landing succeeds. Errors retain recovery state and offer Retry merge.
