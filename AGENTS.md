- 默认分支建议使用 `main` 或 `dev`。
- 本地 typecheck：`bun run typecheck`（或 `bun run --cwd packages/core typecheck`）。
- 测试：`bun run test`（根目录会跑 core 与 bridge 包；core 内单独测：`bun run --cwd packages/core test`）。
- 发布前：`bun run build` → `bun run --cwd packages/core pack`。
- OpenCode 插件开发：`bun run dev <project>`；可选 `OPENCODE_ROOT` 指向 opencode 源码目录。

## Commits and PR Titles

Use conventional commit-style messages: `type(scope): summary`.

Valid types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`. Scopes: `core`, `portal`, `channels`, `bridge`, etc.
