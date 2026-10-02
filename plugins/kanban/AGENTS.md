# Kanban plugin

- Behavior contract: [docs/specs/board.md](docs/specs/board.md).
- Use the installed public BB Plugin SDK and the Project Groups `groups_list` RPC; do not read another plugin's database or import its source.
- Validate changes with `npm run typecheck`, `npm test`, `bb plugin build`, and `git diff --check`.
- Unit test filenames start with `_test_`.
