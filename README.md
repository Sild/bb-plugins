# Personal BB plugins and setup

A portable snapshot of my custom BB plugins and app preferences. Requires **BB 0.44.0 or newer**, Node.js **22.19+**, npm, and Python **3.9+**. Start BB and ensure its `bb` CLI is on PATH.

## Restore on a fresh app

Clone or copy this repository, then run from its root:

```sh
python3 scripts/restore.py                 # Preview only
python3 scripts/restore.py --apply         # Install and restore; prompts for plugin trust
```

Use `--apply --yes` after reviewing and trusting the five plugin sources to skip individual install prompts. The script saves previous public settings to a private temporary JSON file and prints its location. This is a reference backup; automatic rollback is not implemented. An error stops restoration and leaves completed steps in place.

Restoration installs each custom plugin, restores bundled plugin enable/disable choices, provider settings, retry limits, keyboard shortcuts, the Dracula theme, sidebar preferences, completed-turn display, and the four project folders. Add projects using BB, then run the command again to restore their folder assignments and pins by unique project name. Existing unrelated groups/projects are retained. Existing group order is not rearranged.

The command targets the normal BB CLI server, usually `http://127.0.0.1:38886`. For a different instance, set `BB_SERVER_URL` explicitly. Sign in to Codex/Claude separately. Claude's Chrome integration also needs its browser extension and login.

## Keep the repository updated

```sh
python3 scripts/enable_sync.py --project <your-bb-project-id>
```

Find the project ID with `bb project list --json`. This enables one BB script automation that checks **once a minute while BB runs**. It captures enabled, running local plugin sources, adds new local plugins to the collection, and updates plugin states and declared non-secret plugin settings. Built-in plugin code continues to come from BB.

Portability fixes and independent repository edits are preserved through three-way merges. Conflicts stop capture and appear in the automation's run history; after resolving them, resume it in BB. No automatic commits or pushes occur. Source capture does not certify that an in-progress edit is tested. General app/sidebar preferences and project assignments remain the separately saved snapshot.

For an immediate capture:

```sh
python3 scripts/sync_plugins.py
```

The first run establishes private local baselines for existing plugins. Keep the ignored `.bb/plugin-sync-state/` directory: deleting it resets the change baseline. If this checkout moves, run setup again to update the automation's working directory.

## Included plugins

| Plugin | Purpose |
| --- | --- |
| [project-groups](plugins/project-groups/README.md) | Project folders, sidebar hierarchy and new-thread defaults |
| [kanban](plugins/kanban/README.md) | Task status, worktree defaults, acceptance and archive controls |
| [question-inbox](plugins/question-inbox/README.md) | Durable questions, answer-later popups and inbox |
| [review-implement](plugins/review-implement/README.md) | Reviewed Design/Plan/Implement workflows and composer handoff |
| [provider-usage-all](plugins/provider-usage-all/README.md) | Combined provider usage panel |

Workflow configuration lives in `plugins/review-implement/workflow.yaml`; task defaults live in `plugins/kanban/new-task-defaults.yaml`. The Obsidian exception uses `~/Obsidian`; adjust it if the vault is elsewhere. Model availability depends on the installed provider and account.

## Install just one plugin

```sh
cd plugins/question-inbox
npm ci --omit=dev --omit=optional
bb plugin install .
```

After this repository's commits have been pushed, BB can also install an individual plugin directly from Git:

```sh
bb plugin install git:https://github.com/Sild/bb-plugins.git@main --plugin question-inbox
```

A Git install installs code only. Use the restore script from a clone for the full preference preset. Keep a local clone in place when using path installs: BB loads code from that directory. The optional sync automation keeps active local copies in step with this repository.

## Repository format

BB's [official configuration guide](https://github.com/get-bb/bb/blob/main/docs/configuration.md) documents multiple plugins in one repository using `.bb/plugins.json`. Each plugin retains its own package manifest and installs independently. This collection plus a CLI restore script suits a personal setup; a separate marketplace catalog would add discovery metadata but would not restore preferences.

Built-in plugin code comes from BB itself. Credentials, databases, conversations, pending questions, project checkout paths, browser profiles, schedules, provider-native configuration and machine enrollment are not included. Project assignments use names, never old BB IDs. See [the installation contract](docs/specs/installation.md) for exact scope.

## Development checks

Run inside each affected plugin directory:

```sh
npm ci --include=dev
npm run typecheck
npm test
bb plugin build .
```

Preview the restore script and run `git diff --check` for collection/preset changes. Validate a full restore on a disposable BB data directory, not the personal app. See [the recorded validation](docs/validation.md).
