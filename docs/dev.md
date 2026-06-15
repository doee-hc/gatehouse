# Developer Guide

For Gatehouse repository contributors and plugin developers. User installation and Mission workflow: [getting-started.md](./getting-started.md) (English) or [getting-started.zh.md](./getting-started.zh.md) (简体中文).

## Prerequisites

- [Bun](https://bun.sh) >= 1.1
- [OpenCode](https://opencode.ai) >= 1.14.40 and < 1.18.0 (global CLI, or point `OPENCODE_ROOT` at source)

## Package Layout

| Package | npm name | Description |
|---|---|---|
| `packages/core` | `@gatehouse/core` | Main plugin (server + TUI + CLI + Portal API + IM **channels** at `src/channels/`) |
| `packages/portal` | `@gatehouse/portal` | Portal UI (build output merged into core `dist/portal/`) |
| `packages/character-assets` | `@gatehouse/character-assets` | Character sheet generation (local dev only) |
| `packages/weixin-bridge` | `@gatehouse/weixin-bridge` | WeChat iLink bridge |
| `packages/feishu-bridge` | `@gatehouse/feishu-bridge` | Feishu app bridge |
| `packages/qq-bridge` | `@gatehouse/qq-bridge` | QQ official private-DM bridge |
| `packages/qq-onebot-bridge` | `@gatehouse/qq-onebot-bridge` | QQ group bridge (NapCat / OneBot V11) |

All bridge packages depend on `@gatehouse/core` and import `@gatehouse/core/channels`. Bridge sources are also copied into `@gatehouse/core` at build time for bundled installs.

IM channels user guide: [guide/channels.md](./guide/channels.md) · [guide/channels.zh.md](./guide/channels.zh.md). Source: `packages/core/src/channels/`.

## Local Development

```bash
bun install

# Start OpenCode + Gatehouse (project dir is OpenCode's working root)
bun run dev /path/to/project

# If you have local opencode source:
OPENCODE_ROOT=~/path/to/opencode bun run dev /path/to/project

# Portal only (Vite)
bun run dev:portal
```

`bun run dev` runs `prepareGatehouseProject`, generating an isolated `.gatehouse/` and plugin config under the project. Always pass a **project directory** so OpenCode loads config with the correct cwd.

### Portal Development (Without Restarting OpenCode)

**Terminal 1 — OpenCode only:**

```bash
GATEHOUSE_PORTAL=0 bun run dev /path/to/project
```

**Terminal 2 — Portal API + UI:**

```bash
GATEHOUSE_PROJECT_DIR=/path/to/project bun run dev:portal
```

Browser: `http://127.0.0.1:18471/` (Vite dev middleware is embedded in the Portal server; HMR included).

See [packages/portal/README.md](../packages/portal/README.md).

## Portal Offline Cache & Static Export

While OpenCode is running, the Portal API incrementally persists snapshots, blog posts, skills, branding, display config, and team stats to disk under `.gatehouse/internal/portal-offline-cache/`. The Portal UI reads this cache when the backend is unreachable.

After visiting the Portal online at least once (or while the API is running), you can export the cache into the built static bundle:

```bash
GATEHOUSE_PROJECT_DIR=/path/to/project bun run --cwd packages/core script/sync-portal-static-cache.ts
```

This copies `bundle.json` into `packages/core/dist/portal/offline-cache/` (or a custom target path passed as the first CLI argument). Use this for read-only Portal hosting on a VPS without a live OpenCode process.

Implementation: `packages/core/src/portal/offline-disk-cache.ts`, `packages/portal/src/portal/offline-cache.ts`.

## Common Commands

| Command | Description |
|---------|-------------|
| `bun run typecheck` | Typecheck entire monorepo |
| `bun run test` | Run core and all four bridge package tests |
| `bun run build` | Build core (includes Portal static assets) |
| `bun run --cwd packages/core pack` | Pack before publish |
| `bun run channels --help` | IM channels CLI |
| `bun run dev:weixin-bridge` | WeChat bridge dev server |
| `bun run dev:feishu-bridge` | Feishu bridge dev server |
| `bun run dev:qq-bridge` | QQ official DM bridge dev server |
| `bun run dev:qq-onebot-bridge` | QQ group (OneBot) bridge dev server |

## Publishing

See [packages/core/docs/PUBLISH.md](../packages/core/docs/PUBLISH.md). Record user-facing changes in [CHANGELOG.md](../CHANGELOG.md) before each release.

## Test Fixtures

Lightweight smoke fixtures live in `packages/core/test/fixtures/core-example-smoke-v1/`. Run tests:

```bash
bun run test
# Or core only:
bun run --cwd packages/core test
```

CI (`.github/workflows/ci.yml`) runs `typecheck`, `test`, and `build` on push/PR.

## English Templates

`packages/core/templates/en/` mirrors `zh/`. When `locale: en`, init/sync uses English skills and prompts; missing files fall back to `zh`.
