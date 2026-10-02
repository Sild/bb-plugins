# Question Inbox

Behavioral contract: [docs/specs/questions.md](docs/specs/questions.md).
Use only the public BB Plugin SDK. Keep permission/credential workflows separate.
Run `npm run typecheck`, `npm test`, `bb plugin build`, and `git diff --check`.
Unit test files use the `_test_` prefix. Preserve unknown delivery as uncertain;
never retry a user's answer automatically after a dispatch acknowledgement is lost.
