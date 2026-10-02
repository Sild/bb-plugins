# Persistent questions

Agents request consequential missing information through `ask_persistent_question`
or `bb questions ask`. The request is durable before the tool returns pending.
Agents can continue independent work, but may not infer an answer from elapsed time.
They stop dependent work and finish as waiting when independent work is exhausted.
The plugin does not forcibly suspend provider computation.

Questions open only when the user clicks Answer in the inbox or the question
badge in a thread header. The form opens in place without navigating to the
owning thread. Native HTML dialogs are portaled to the document body so their
top layer stays above host windows; stale offscreen pane coordinates fall back
to the viewport.
The app displays a popup with choices (none preselected) and optional free text.
Answer later and Escape save the draft and hide the popup, leaving the question in
Questions and the Needs your answer badge. Questions have no expiry. Server-side
SQLite state survives plugin/app/server restarts; local draft writes protect the
interval before the server autosave. Revision checks reject stale concurrent writes.
The Questions page is paginated. Thread headers show a scoped unanswered count.

Native user_question interactions and the bundled Ask User Question plugin's forms
are copied when announced. Pending interactions are recovered in paginated thread
scans on startup. Approvals, credentials and arbitrary plugin forms are excluded.
Plain prose is not heuristically classified; agent instructions prefer the tool.
Existing provider sessions receive new tools/instructions on their next session
construction, not by interrupting their current work.

Live native answers resolve the original interaction. Expired/interrupted questions
remain answerable: submission sends the question and selected answer as a follow-up
in the original thread, steering active work or starting an idle turn. Questions
answered through the original native UI are reconciled out of the inbox. Archived
and deleted threads close their unanswered questions. Existing archived threads
are reconciled when the inbox loads. Users can also dismiss a question directly
from the inbox without sending an answer. Archived threads are not auto-unarchived.

The answer is persisted before dispatch and only hidden after BB accepts it.
Concurrent/repeated submissions are rejected. If dispatch acknowledgement is lost,
the answer remains marked uncertain; the user must check the thread and explicitly
retry. There is no automatic resend across a restart because BB's send API does not
expose an idempotency key. Queued delivery is acceptance by BB, not proof the agent
has consumed the message. Agent behavior still depends on following instructions.

Acceptance checks cover reload/draft preservation, late native answers, live native
resolution, duplicate submissions, invalid inputs, stale draft revisions, uncertain
delivery, and popup/inbox behavior. No tests answer real user questions.

CLI `--choices` accepts a JSON array of value/label/description options, validated
with the same schema as the tool. Open persistent questions can be reformatted
through revision-checked `revise`; existing drafts must remain valid.

The popup is centered within the owning thread pane, capped at 640px wide and
720px tall with 12px pane margins. Its header and action footer remain visible;
only the question body scrolls. Pane and viewport resizes recompute its placement.
The header anchor identifies an unsplit thread container; split panes use their
host pane identifier. While no pane anchor is mounted, it remains viewport-bounded.

Custom answer is an explicit alternative to the suggested options. Selecting it
clears all suggested choices; typing without a suggestion also selects Custom.
Selecting a suggestion labels the text field Additional comments (optional).
Neither mode is preselected on a new question. Drafts retain this distinction
without changing the native answer schema: custom has no selected option values.
Follow-up messages label Custom answer, Selected answer, and Additional comments.
