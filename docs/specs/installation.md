# Installation and portability

This repository preserves the five custom plugins and portable BB preferences from the personal installation. BB 0.44.0 / Plugin SDK 0.5.29 is the captured baseline.

## Collection

`.bb/plugins.json` indexes `plugins/<id>` using BB's collection schema. Each directory has its own package manifest, source, lockfile, tests, documentation, and skill files. The collection does not override package identity. Plugins install separately with `--plugin <id>`; the root is not a single plugin.

The source snapshot contains Project Groups, Kanban, Question Inbox, Review and Implement, and Provider Usage All. Existing workflow YAML remains authoritative for model, reasoning, prompts, and review orchestration. Kanban's checkout exceptions support `~/` resolved against the BB server user's home directory; remote machines with different checkout paths need explicit configuration.

## Restore

`python3 scripts/restore.py` only previews commands. `--apply` targets the running BB selected by the normal CLI environment, backs up public settings to a private temporary file, installs missing built-ins and the collection's plugins, and applies the preset through public CLI and RPC methods. `--yes` explicitly trusts the local sources and skips individual install confirmations. Failures stop immediately; there is no silent fallback or automatic rollback. Completed steps can be reapplied after resolving the failure.

`preset/settings.json` stores enabled/disabled plugin states, non-secret plugin settings, general preferences, completed-turn display, experiments, sidebar preferences without local IDs, keyboard overrides, appearance, automatic AI-service choices, group names/icons/order, project folder assignments and pins by project name. Group definitions are created in recorded order on a fresh instance. Matching existing groups are updated; unrelated groups/projects are retained. Existing group order is not rearranged. Project names must match uniquely; missing or ambiguous matches are reported and skipped. Reapply after adding projects.

Built-ins ship with BB; their source is not duplicated. Production dependencies are installed before path installation. The restore script does not copy databases, thread/task/answer state, credentials, browser sessions, schedules, machine enrollment, access/transport settings, host concurrency overrides, provider logins, native Codex/Claude configuration or memories. Global concurrency was automatic at capture. Custom instructions and custom ACP agents were empty.

## Acceptance

- Collection entries resolve to packages with matching IDs and valid BB manifests.
- Every copied plugin typechecks, passes its existing tests, and builds.
- Installation succeeds with development dependencies omitted.
- A disposable BB instance loads all five plugins and reflects the captured portable preferences and groups.
- Reapplying does not duplicate project groups; project IDs are resolved in the target instance.
- The original personal BB instance and source directories stay unchanged.
- The repository contains no generated bundles, installed dependencies, databases, credentials or local instance IDs.
