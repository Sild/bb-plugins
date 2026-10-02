# Thread board

## Status and persistence

Every visible, unarchived thread is one card. Active provider subagents or active descendant threads take priority and keep the parent Active, even if the parent has reported Waiting, Done, or has pending input. Descendant activity includes hidden threads and threads outside the current project filter or card limit; archived children are excluded. Pending input otherwise means Waiting. Errors requiring user attention and unknown idle states mean Waiting. Active, starting, provisioning, host reconnection, and stopping mean Active. Pending threads are Backlog. Idle threads with active subagents are Active; other idle threads are Done only when the agent explicitly reported completion for the latest turn. Otherwise they remain Waiting. Ordinary final text is not parsed for questions.

Columns are derived on every read; legacy manual column metadata is ignored. Agent outcomes are stored against the latest `client/turn/requested` or `turn/started` event ID, queried newest first with a one-row limit. A newer turn invalidates a previous completion report, including across plugin downtime. `bb kanban report done|waiting` reports only the invoking agent thread's outcome; it cannot set arbitrary board columns. New sessions receive mandatory outcome reporting in direct agent configuration instructions as well as the bundled skill. A review is complete when its findings have been delivered; recommendations for the parent do not mean the reviewer needs user input. Existing sessions may need refreshed instructions; unreported idle work safely remains Waiting.

User acceptance is stored, as the reviewed thread's `updatedAt` revision in per-thread plugin metadata. A compact, theme-aware status row above the thread composer displays the current Kanban label and description for every state, with text independent of color and a wrapping layout. The composer shows Accept only for Done threads and the server rechecks status before accepting. New activity takes precedence; a changed revision invalidates acceptance. If the first Accept click sees a stale revision, it shows a warning without accepting or starting a merge. The next explicit Accept anyway click acknowledges updates and accepts the current Done revision even if the timestamp changes again. Live status and Git checks still apply; renewed activity or changing threads clears the acknowledgement. Unrelated metadata is preserved.

## Board and project selection

The board has five shared column headings, in Backlog, Waiting, Active, Done, Accepted order, and a horizontal row for each selected project with at least one visible card. Empty project sections are hidden, while all projects remain available in the filter. Selecting only empty projects shows an explicit no-threads message. Cards have no manual status selector or drag movement. Clicking a card uses BB's native thread navigation. Each project header has one compact + New thread action, including when collapsed. It opens BB's native new-thread form with that project selected and the prompt focused. The text-sized native button supports Tab and Enter/Space. Status columns contain only card stacks; no empty control row is reserved. Blank column space, card bodies, titles, and parent links cannot trigger creation. Status remains derived from activity rather than the location of the creation action.

Each project header can collapse its row independently while retaining its visible-card count and archive menu. Parent only hides every card with a parent thread ID, including children whose parent is outside the current result. Column and board counts reflect the visible cards; projects containing only subtasks disappear and show a specific empty message when no parent cards remain. Collapse lasts for the mounted board session, including refreshes. Parent only, Show links and Show archive are saved as separate boolean preferences in this BB client’s local browser storage, scoped to the owning plugin. They restore before the initial board query after navigation, remount or reload and update across windows on storage events. Defaults remain Parent only off, Show links on and Show archive off. Storage failures are visible while the controls remain usable. Show links remains available when subtasks are hidden and resumes drawing when they are shown again.

The project filter supports independent project checkboxes, folder checkboxes, search by project/folder name, all, and none. `null` selection means all projects; an empty array means none. A folder checkbox selects/deselects its whole folder, including projects hidden by a search. Clear selects none. Selected projects are queried before the 500-thread limit is applied, and truncation is explicit. Obsolete project IDs are ignored. Filter state lasts for the mounted board session.

The Project Groups plugin's public `groups_list` RPC supplies folders, appearance, ordering, assignments, and pins. Pinned projects appear first, followed by ordered folders, Other projects, and Other threads (the personal project), with pinned projects also available in their original folder in the filter. Selection is by project ID across both appearances. The board renders each project and its cards once, prioritizing the Pinned position. Unassigned or stale folder assignments remain accessible. The grouping integration is read-only. A missing/failed integration renders ungrouped projects with a visible warning rather than hiding their cards. Folder organization refreshes when the filter opens, on manual refresh, window focus, and board reloads.

## Updates and failures

Thread lifecycle signals, debounced thread events, pending interactions, and successful acceptance refresh open boards. Socket reconnection reconciles missed signals. A late response to an older filter cannot overwrite the current board. Failed board loads are visible and retryable.
During background refresh, the last thread count stays visible and archive controls keep their state; a successful result replaces the number directly.

## Acceptance checks

Tests cover runtime precedence, reviewed revisions, metadata preservation, rejecting acceptance of Waiting work, multiple-project queries, empty selection, folder grouping/pinning, folder lookup failure, filter race ordering, multiselection, native navigation, and Done-only composer acceptance. Typecheck and BB bundle build cover the installed SDK integration.

## Draft limitation

The new-thread and thread composers show a one-click Save draft action beside the native submit controls. It is disabled for an empty draft or while submission is in progress. The action uses the composer's own submit pipeline, preserving attachments, mentions, provider, model, worktree, and permissions, then holds the queued message until the user chooses Send now. Ordinary Enter retains native submission behavior. Like BB's built-in Drafts plugin, the queue hold depends on its owning plugin: disabling Kanban can release saved drafts. No Shift+Enter override is installed.

## Parent and child relationships

Cards carry the SDK's parentThreadId. Each project is ordered as parent-first families before distributing cards into status columns. Roots and siblings retain their incoming order; descendants follow their parent, including when an intermediate ancestor is in another column. Missing parents act as roots, and malformed cycles retain every card once. Columns retain independent compact stacks; this sorting does not add blank rows to vertically align cards across columns. By default, quiet rounded arrows point from parent to child within each project row, including across nonadjacent columns and backwards across statuses. Adjacent cards in one column use short bottom-to-top arrows. Cross-column links use direct curves when their bounding corridor is clear of cards; blocked links use card-side gutters and a reserved top rail. Nested gutter links use distinct incoming and outgoing ports, and endpoint dots are omitted to reduce clutter. Hovering or focusing a card emphasizes its immediate relationships and dims other arrows. Show links hides the overlay without removing accessible parent navigation. Each child has a native-navigation Parent link; parents outside the visible result (including filtered/limited cards) show Outside this view. Cross-project relationships use the parent link rather than drawing through other project sections. Layout changes and refreshes remeasure connections; scrolling carries the overlay with its cards. No animation or new diagram dependency is required.

Design references: [NN/g: complex application design](https://www.nngroup.com/articles/complex-application-design/) for contextual emphasis and reduced clutter; [React Flow accessibility](https://reactflow.dev/learn/advanced-use/accessibility) for keyboard-operable relationship information. The routing and styling are tailored to this board.


## Direct thread actions

An icon-only action group replaces the native top thread-header “…” trigger in the installed BB 0.44 layout. The actions are Archive (Unarchive on archived threads), Pin/Unpin, Mark unread/read, Move to section, Copy thread link, then Delete separated by extra spacing. Every icon has an accessible name and a shared Radix tooltip (150 ms hover delay, immediate keyboard focus, Escape dismissal, portalled content with collision avoidance). Native title attributes are omitted to avoid competing tooltips. Rename remains available through the host title double-click interaction; this plugin does not add a rename control or intercept the title. Archive is first and subtly outlined. No actions row is rendered above the composer.

The public header slot supplies the owning thread. A cleanup-safe DOM attachment portals the group into the installed host's `thread-detail-header-actions-menu` container, hides only its trigger, and restores that trigger when unmounted. It never crosses a split-pane boundary. If the expected container is unavailable after a host update, the icons remain in the native header extension slot and the original menu stays available. This is an explicit version-sensitive host-DOM integration, not a public menu-replacement API.

Delete and Archive outside a Kanban thread window invoke host-owned flows, preserving child-archive and deletion confirmations. Archive in a thread window over the same Kanban pane uses public SDK archival with child confirmation and returns to the board after success. Section selection opens a native modal dialog with focus containment and Escape dismissal. Async actions disable the controls while pending and show errors. Copy uses the SDK-provided thread href resolved against the current app URL and reports clipboard success. Switching threads discards transient editor state. All actions target the owning pane's thread.

Ordering prioritizes the user's frequent Archive action, groups organization actions, and separates Delete. The user explicitly requested symbols with hover explanations in place of visible labels. Related reference: [Atlassian spacing](https://atlassian.design/foundations/spacing) for related action grouping.

## Bulk archive and archive history

Archive accepted is an icon immediately after the Accepted counter, with a full
hover/focus tooltip, and targets
Accepted tasks in selected projects. Each project header has a compact archive
menu immediately before its folder label, with explicit Archive Accepted tasks and
Archive all project tasks choices. The latter includes hidden and running tasks.
No archive controls occupy separate rows beneath column headings or card stacks. Menu labels, tooltips,
and keyboard support keep the compact icon discoverable and its scope explicit. A modal identifies the scope, explains stopping/environment effects,
and allows cancellation. Execution uses freshly queried tasks, paginates beyond the
500-card display limit and calls the host archive API. The board refreshes after execution;
the modal closes automatically when every task archives successfully, including when no
tasks remain eligible. Partial failures keep the modal open with counts and reasons.
It accepts completed review subthreads automatically after Review and Implement delivers their feedback. Ordinary tasks still require user acceptance.

The installed SDK's archive action recursively archives child, lifecycle-dependent,
and hidden source threads. The plugin refreshes those relationships and project membership before each root,
traverses archived intermediate nodes, and skips roots with live dependents outside the scope.
Accepted status is rechecked immediately before each archive. Archived dependents
still working cause the root to be skipped. Failures leave other eligible roots
processable; the result lists up to 20 reasons and a full failure count. The host
provides no atomic conditional archive: a concurrent new child or status change
between the final check and the host call remains a race limitation.

Show archive is off by default. Enabling it adds an Archived column and a compact
time-frame selector: 1d, 1w, 2w, 1 month, 3 months, 6 months, 1 year. These are rolling
1/7/14/30/90/180/365-day windows, inclusive at the lower boundary. Disabling it
immediately removes archived cards and the column, including during an in-flight
refresh. Archived cards sort by recorded acceptance timestamp descending, with ID
as tie-breaker, independently of parent-first ordering. Project-only archived rows
remain visible while this option is enabled.

Successful acceptance now records acceptedAt separately from acceptedFor (the reviewed
revision). acceptedAt preserves the most recent historical acceptance even if work
resumes; later acceptance replaces it. Archive history filters on that timestamp,
not archive time or thread modification time. Archived tasks without a recorded
acceptance timestamp remain visible after dated cards, regardless of the time filter,
with a count notice; historical times are not invented. History queries paginate before filtering and keep the newest 500 matching
archived cards with a separate truncation notice. Normal board behavior and its own
500-card limit remain independent. Archive history does not query when toggled off.


Archive control placement follows contextual proximity and grouped secondary-action
principles from [NN/g contextual menu guidance](https://www.nngroup.com/articles/contextual-menus-guidelines/)
and [Atlassian panel guidance](https://atlassian.design/components/panel/usage).
The project menu trades one extra click for reduced repeated chrome and explicit scopes;
the board-wide Accepted action stays directly visible next to its column counter.


## Task Git lifecycle

The native new-task composer defaults Git projects to **Project checkout** on the current active local branch. No branch or worktree is created by default. Users can explicitly select **Task worktree** for isolation; its read-only Branch from display follows the active local checkout branch and creation reads the branch and committed HEAD at launch. It seeds the environment once per selected project and applies Codex GPT-6.1-Sol with High reasoning after environment reconciliation, preserving permissions and service tier. The model default also covers the root composer with no project. Users can change these selections after the seed; typing a draft does not reset them. The model default also applies to personal and non-Git projects. An unavailable model shows an actionable error. Deliberately selecting another environment retains that provider's own semantics. Input is locked while the asynchronous seed resolves. All Git projects use the `project-checkout` provider configured in `new-task-defaults.yaml`; no default assumes main. Personal and non-Git projects retain their normal environments. CLI, fork and other plugins' embedded composers keep their explicit creation semantics; they are not redirected by this composer customization. Detached Git checkouts show an actionable error rather than choosing an assumed branch.

Agents validate and commit task-owned changes before Done. `bb kanban report done` and Accept reject dirty Git workspaces or unfinished Git operations. No-change/review tasks need no empty commit. The plugin never stages or commits arbitrary files on the agent's behalf.

Accept on an exclusive managed Git worktree captures the current branch in the project checkout on the same machine. It verifies repository identity and distinct branches, clean workspaces and no Git operations, previews the merge, and locally merges committed task changes into that captured branch. It never pushes. Conflicts are previewed without changing the destination index/worktree. The original task agent resumes with instructions to merge the destination into its task branch, resolve conflicts, validate, commit and report Done. Landing retries after the agent becomes idle. Other automatic-merge failures also involve the agent; unrelated dirty destination changes must be preserved and may require user input. A changed destination branch stops landing instead of silently choosing another branch.

Persisted per-task merge jobs survive plugin reloads and server restart. Jobs continue on idle events, a recovery service and a one-minute schedule. During landing, conflict resolution and cleanup the card remains in Active with **Merging...**, even if the agent reports Done or Waiting. Errors are visible with Retry merge. Duplicate acceptance is rejected, and this plugin serializes Git landings into one checkout. New message dispatch waits during landing/cleanup; conflict-resolution turns can run normally. The core environment-delete command refuses any unarchived attached thread, even when idle; an immediate pre-delete activity recheck also defers cleanup when a task resumes. Explicit Send-now can bypass plugin dispatch waits, so the core teardown guard remains essential.

After a verified merge and clean task workspace, acceptance records the captured thread revision and retains the worktree and branch while any unarchived thread is attached, including the accepted task itself. A no-change research task verifies that its captured commit is already in the destination and completes without creating a merge commit. Archiving retires the environment through core's provider lifecycle; the local branch remains available. Existing jobs blocked specifically by `HTTP 409: Environment still has live threads` recover by verifying the captured commit and recording acceptance, without merging newer commits. Other errors retain recovery state. For legacy cleanup jobs whose threads are already archived, the plugin can remove an exclusive environment and its fully merged local branch; teardown or branch cleanup failure retains the job for retry.

Accept captures the task commit and thread revision at the click. When another unarchived thread shares the environment (including hidden threads), landing requires every peer to belong to the same parent-thread tree and be idle. An unrelated peer blocks landing. The plugin merges only the captured commit and verifies it; later commits made in the shared worktree are not included. Sharing is rechecked before teardown; Retry merge follows the same path. Conflict resolution refreshes the captured commit after the agent validates and reports Done. Older shared merge jobs without a captured commit stop for manual review. Unmanaged worktrees are rejected by Accept. Both the built-in git-worktree provider and Task worktree are supported. Task worktree uses plugin-owned paths and durable ownership records for idempotent creation and cleanup, and refuses dirty removal. Acceptance of personal/non-worktree tasks records the reviewed revision without Git teardown.


## Agent picker focus compatibility

In the installed BB 0.44 thread drawer, the modal provider/model/reasoning popup
blocks pointer events on the surrounding thread. A scoped content script keeps
that drawer clickable while its agent picker is open, so clicking the thread
closes only the picker. Clicking the composer editor gives that editor focus
after the popup releases its focus trap, instead of restoring focus to the
picker trigger. Escape and clicks in the picker retain native focus behavior.
Other popups and clicks outside the drawer retain native dismissal behavior.
This is a version-sensitive host DOM/FocusScope compatibility fix, with no effect
when the expected drawer and picker markers are absent. Unloading the plugin
removes its style, listeners, and pending focus timers.

## Reviewed planning workflows

Design and Plan children produced by the Review and Implement plugin can be accepted automatically only after they are idle and Done, the artifact was delivered to its parent, and their independent child review has been accepted. This records acceptance without merging or removing the shared workspace. Review feedback can request corrections; the revised artifact must be independently reviewed again before it is delivered as complete. Implementation acceptance remains a user action.

Automatic acceptance recognizes stage-prefixed review titles: `[👁][PLAN] Task`, `[👁][DESIGN] Task`, and `[👁][</>] Task`. Legacy review titles remain supported. Plan and Design acceptance still requires the matching parent relationship and an accepted independent review of the current revision.

Workflow agents owned by review-implement can declare workflowParentThreadId in their public plugin metadata. Kanban uses this relationship for cards, active ancestors, automatic review/plan acceptance and shared-checkout ancestry. Native parent links stay empty to avoid core lifecycle messages waking producers or returning unreviewed artifacts. Other plugins and ordinary tasks use native parent links.

## Bulk Done acceptance

The Done heading and each project header have a compact double-check icon, labelled Accept all Done tasks. The project header uses the same column grid as its cards, placing acceptance directly above the Done column. The icon follows Lucide CheckCheck (https://lucide.dev/icons/check-check) and is visually distinct from Accepted archiving. Project acceptance remains in the header when the row is collapsed; no acceptance control is rendered inside the card cells. The global action uses selected projects; the project action uses only its project. A confirmation previews every visible, unarchived Done task in scope, including tasks beyond the 500-card display limit and children hidden by Parent only or collapse. Only previewed revisions are submitted; newly Done tasks are not silently added. The server rechecks scope, current status and revision and uses ordinary acceptance, including Git validation and managed-worktree merging. Changed, busy or failed tasks do not prevent the remaining tasks from proceeding. Results distinguish Accepted, merges still running and failures; failed tasks can be inspected and retried individually. Empty selection or preview performs no acceptance.

When the thread header Archive action is used in a thread window above the Kanban board, successful archival returns to the board using SDK navigation rather than the native sidebar route repair. Threads with children require confirmation before recursive archival. Cancellation or failure keeps the thread open. Archiving outside the board retains the native flow; a navigation away during the request is not overridden.

The Open Kanban board command defaults to Cmd+D (Ctrl+D elsewhere) and directly
opens the board from any app view. Returning restores this window's horizontal
and vertical scroll, selected projects, collapsed project rows, and archive time
frame after data loads. Session storage isolates this position from other windows;
unavailable or invalid storage starts at the default view. Display flags retain
their existing persistent preferences. Escape keeps BB's native Back binding.
