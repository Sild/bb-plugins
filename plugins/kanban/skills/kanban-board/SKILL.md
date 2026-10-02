---
name: kanban-board
description: Report task completion or waiting for input so the automatic BB Kanban board can distinguish Done from Waiting.
---

# Kanban board

Runtime determines Backlog, Active, and structured Waiting. Idle alone does not mean completion.

Before your final handoff, report the semantic outcome for your current thread:

For Git tasks, validate and commit task-owned changes before reporting Done. Preserve
unrelated changes; a clean worktree with no changes needs no empty commit. The Done
command rejects a dirty Git workspace or an unfinished Git operation.

New Git project tasks in the native composer default to a fresh worktree from the
project checkout's current active local branch using Task worktree. The branch is read at actual creation time; Branch from is read-only and never defaults to origin/main. Obsidian defaults to Project checkout on the current active branch. Personal and non-Git tasks retain their environments.
When another unarchived thread shares the task environment, Accept captures the
task commit and requires every sharing thread to belong to the same task tree.
It waits until each is idle, merges that captured commit, records acceptance,
and retains the worktree and branch for the sharing threads. Retry merge follows
the same checks.
Accept merges an exclusive managed task worktree into the project checkout's branch captured at
the click, then records acceptance while retaining the unarchived task workspace.
No-change research needs no merge commit. Archiving retires the workspace through
BB; the local branch remains available. Conflicts resume the task's agent
to merge the destination into the task worktree, validate and commit the resolution,
and report Done again. The plugin retries after the agent is idle. The task remains
Active with Merging... until landing is verified; failures retain recovery state.

- Run `bb kanban report done` when the assigned task and required validation are complete. For a review subtask, delivering the findings completes the review, even if they contain recommendations or follow-up work for its parent. This report is required before the final reply; do not wait for the user to remind you.
- Run `bb kanban report waiting` when you ask for a decision, clarification, approval, or other input required to finish. A final reply asking a required question is Waiting, not Done.
- Waiting on a subtask is still Active. Do not report waiting for subagent work; BB derives Active from running subagents.
- If a completed report becomes obsolete within the same turn, report waiting before yielding. Reports belong to the current turn; a new turn invalidates prior completion.

These reports do not move running work out of Active. Pending interactions and subagent waits take precedence. Idle with no completion report defaults to Waiting. Never use the obsolete `bb kanban move` command.

Only the user accepts ordinary Done work with the Accept button in the thread composer. Workflow review subthreads are accepted automatically after their feedback reaches the producer or root and the review is idle and Done. Reviewed Plan and Design artifacts are also accepted automatically after delivery and accepted independent review. Implementation acceptance remains a user action. Do not accept ordinary work on the user's behalf.

Use `bb kanban list [--project <id>] [--project <another-id>] [--json]` to inspect cards.
