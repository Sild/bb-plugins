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
- The personal plugin sources stay unchanged; enabling sync adds an explicitly requested BB automation.
- The repository contains no generated bundles, installed dependencies, databases, credentials or local instance IDs.


## Automatic capture

`python3 scripts/enable_sync.py --project <project-id>` enables or updates one BB script automation, running once per minute while BB is running. It stores a small wrapper that executes this checkout's current `scripts/sync_plugins.py`; moving the checkout requires running setup again. `python3 scripts/sync_plugins.py` provides an immediate manual capture.

The first capture initializes merge baselines for existing collection plugins without replacing their portability patches. Subsequent captures inspect enabled, running path-installed plugins, copy supported source/documentation/assets, mirror removals, and index newly active local plugins. Built-in code remains provided by BB. The preset records plugin enabled states and declared non-secret settings of running plugins. Global app preferences remain the saved snapshot and are not automatically recaptured.

The ignored `.bb/plugin-sync-state/` directory stores private local baselines and a process lock. File changes are merged against the last active source snapshot. Independent repo changes are preserved; conflicting edits abort the entire planned capture before writes. Source/repo changes observed during scanning also abort. Individual file writes are atomic. A process interrupted between writes can leave a partial capture; the next run retries against the unchanged baseline. No auto-commit, push, build, reload, or active-source mutation occurs. New bb-plugins tasks default to Project checkout, like Obsidian, so captured changes and task commits share the active local branch rather than blocking a separate task-worktree merge. Existing worktree tasks retain their environments and still require a clean destination before landing. Copied source can contain unfinished work and needs normal validation before a release.

Skipped content includes dependency/build/state directories, symlinks, `.env` files, credential/secret/token filenames, and unsupported file types. Settings declared secret by their plugin schema are excluded. Authors must not embed credentials in ordinary source files or non-secret settings. Disabled/failed plugins' sources and settings are not captured, and plugins removed from BB retain their last saved repository copy. The supported source extensions are listed in `sync_plugins.py`.

BB pauses an automation after three consecutive failures. Conflicts/errors appear in its run history; resolve/reconcile the named file, then resume the automation in BB or run setup again. Repository-only settings use three-way merging too. Group/project assignments and general UI settings continue to use the separately captured preset.
