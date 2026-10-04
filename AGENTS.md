# BB plugin collection

- Installation and portability contract: [docs/specs/installation.md](docs/specs/installation.md).
- Each directory under `plugins/` is an independent BB plugin. Keep its identity and local instructions.
- Use the installed public Plugin SDK; keep runtime dependencies available with development dependencies omitted.
- For plugin changes: `npm ci --include=dev`, `npm run typecheck`, `npm test`, and `bb plugin build .` in the affected directory.
- For collection/preset changes: preview `python3 scripts/restore.py`, check JSON, and exercise restoration on a disposable BB instance. Never use the personal instance as a test fixture.
- Run `git diff --check` before committing. Keep credentials, databases, installed dependencies, and generated bundles out of Git.
- For sync changes: `python3 -m unittest discover -s scripts -p '_test_*.py'`; check the automatic-capture contract in the installation spec. Never commit `.bb/plugin-sync-state/`.

- Task completion leaves changes uncommitted for review. Validate and stage only task-owned hunks, then use `bb kanban report done --commit-message "scope: summary"`. User Commit commits the prepared staged snapshot while leaving the task Done; Accept commits any remaining prepared snapshot and accepts the task. Read-only tasks report Done without a commit message. Commit earlier only when explicitly requested.
