- Prefer `main` or `dev` as the default branch.
- Local typecheck: `bun run typecheck` (or `bun run --cwd packages/core typecheck`). Husky runs typecheck automatically before `git push`.
- Tests: `bun run test` (root runs core and bridge packages; core only: `bun run --cwd packages/core test`).
- Before release: `bun run build` → `bun run --cwd packages/core pack`.
- OpenCode plugin development: `bun run dev <project>`; optionally set `OPENCODE_ROOT` to the OpenCode source directory.

## Commits and PR Titles

Use conventional commit-style messages: `type(scope): summary`.

Valid types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`. Scopes: `core`, `portal`, `channels`, `bridge`, etc.
