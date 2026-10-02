# Question Inbox for BB

Persistent question popups with answer-later drafts, a Questions inbox, and thread
header counts. Uses supported BB SDK extension points rather than patching the app.

Use **Questions** in the sidebar or **Needs your answer** to reopen a dismissed
question. **Answer later** keeps it saved indefinitely. **Submit answer** sends the
answer to its original thread, even if the original interaction has expired.

The native `ask_persistent_question` tool supports choices and free text. In an
already-running session, agents can use `bb questions ask --question '…'`.
Add `--choices '[{"value":"a","label":"First choice"},{"value":"b","label":"Second choice"}]'`
for clickable options. Automatic popups stay in their owning thread.
New provider tools/instructions apply when BB next constructs the provider session.
Native Codex/Claude user-question interactions are captured automatically.

Install locally with `npm install --include=dev`, `bb plugin build`, then
`bb plugin install . --yes`. Disable with `bb plugin disable question-inbox`.
Runtime questions live in BB's plugin SQLite database; disabling does not erase them.
See [the specification](docs/specs/questions.md) for behavior and limitations.

Validation: `npm run typecheck`, `npm test`, `bb plugin build`.
