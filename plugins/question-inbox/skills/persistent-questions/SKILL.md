---
name: persistent-questions
description: Ask the user for missing information or consequential choices in a persistent popup that remains available for later answers.
---

Use `ask_persistent_question` for clarification, preferences, and consequential
choices instead of writing questions only in plain text. If that tool is not yet
available in the current provider session, use:

`bb questions ask --question 'Complete question text?'`

For choices, use structured options, never a numbered paragraph in the prompt:

`bb questions ask --question 'Which scope?' --choices '[{"value":"small","label":"Small scope","description":"Only the requested change"},{"value":"full","label":"Full scope"}]'`

Do not repeat the question in chat after posting it. A short waiting status is enough.
Popups open in the owning thread; the Questions inbox and badge remain available elsewhere.

The CLI defaults to the current thread; `--thread` selects a specific thread.
`bb questions list` shows unanswered questions for the current thread.
The structured tool accepts questions with unique ids, prompt, optional options
(value, label, description), multiSelect and allowFreeText. It returns a pending
receipt immediately, not the user's answer. Do not re-ask an unanswered question.
Continue independent work. Never choose an answer based on silence, timeout, or a
preselected option. Pause answer-dependent work; when nothing independent remains,
report waiting and end the turn. Submitting an answer resumes the original thread.
Use dedicated tools for permissions and credentials. Do not put secrets here.
