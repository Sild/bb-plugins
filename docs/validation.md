# Snapshot validation

Validated locally against BB 0.44.0 / Plugin SDK 0.5.29.

- All five packages installed with `npm ci --include=dev`, typechecked, passed their existing tests, and built with `bb plugin build .`.
- Test totals: Kanban 115, Question Inbox 27, Project Groups 9, Review and Implement 38, Provider Usage All 2; 191 total.
- Production-only dependency installation and collection path installation were exercised by the restore script on a disposable BB instance.
- All 37 captured plugin enabled states matched; every enabled plugin reported running. All saved plugin/general settings, completed-turn display, experiments, UI preferences, keyboard overrides, appearance, and AI-service choices matched through public CLI reads.
- Four folder definitions matched. Reapplying kept the same IDs. Disposable projects verified unique-name folder assignment and pin restoration.
- JSON/collection/package entries, Python parsing, source portability scan, and Git whitespace checks passed.

The disposable server used `/tmp/sild-bb-restore-check` with ports 39886/39887, launched using the installed `bb-app.js start --data-dir ... --server-port 39886 --host-daemon-port 39887 --bundled`. Its npm cache was redirected to `/tmp/sild-bb-npm-cache` for sandbox compatibility. The server was stopped after validation.

Fresh-install verification exposed and fixed Kanban's frontend import of a backend contract module: the worktree provider ID now resides in a shared constant module so building with development dependencies omitted succeeds. The Obsidian checkout exception now expands `~/Obsidian` instead of carrying the original machine's absolute home path. Three packages received standard validation/build scripts; other copied plugin behavior and workflow configuration were preserved.

This verifies installation, server loading and saved state. Desktop visual behavior, provider authentication, real workflow launches, remote Git installation, and publication were not exercised. The original personal BB plugin sources and configuration were left unchanged.
