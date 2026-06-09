# Gatehouse Portal

Phaser 3 office inside a **four-tab portal shell** (办公室 / 博客 / SKILLs / 团队数据). Run via `bun run dev <project>` (see below).

## Run locally

**Recommended — with OpenCode + real project data** (from repo root):

```bash
bun run dev ../your-project
```

This starts OpenCode and Portal (`http://127.0.0.1:18471/`) with API + Vite dev middleware on the same port. Data is read from the project's `.gatehouse/` directory.

Disable portal sidecars:

```bash
GATEHOUSE_PORTAL=0 bun run dev ../your-project      # no portal at all
GATEHOUSE_PORTAL_UI=0 bun run dev ../your-project   # API only, static UI from dist/portal (requires bun run build)
```

Office agent behavior (idle wander, floor-click release) is configured in `.gatehouse/config.yaml` under `portal.office` (project overrides `~/.config/gatehouse/config.yaml`).

```yaml
portal:
  office:
    idle_wander: true      # false = idle agents stay at desks
    play_release: seat     # seat | wander — after floor-click easter egg
```

### UI / Portal development (restart without OpenCode)

OpenCode and the Portal stack are separate. For UI or Portal API work, use two terminals so agent sessions are not interrupted:

**Terminal 1 — OpenCode only:**

```bash
GATEHOUSE_PORTAL=0 bun run dev /path/to/project
```

**Terminal 2 — Portal API + UI together:**

```bash
GATEHOUSE_PROJECT_DIR=/path/to/project bun run dev:portal
```

Browser: **`http://127.0.0.1:18471/`** (display port; Vite HMR runs as middleware on the same server).

Admin panel (Channel 运维): **`http://127.0.0.1:<admin_port>/admin`** (see terminal / `portal-runtime.json`).

| Command | What it restarts |
|---------|------------------|
| `bun run dev:restart` | Portal server (API + Vite middleware) |
| `bun run dev:stop` | stop Portal |

Most UI edits hot-reload via Vite. Restart after Portal API (`packages/core`) code changes.

Or from this package:

```bash
cd packages/portal
bun run dev
```

If the default port is busy, set `GATEHOUSE_PORTAL_PORT` / `GATEHOUSE_PORTAL_ADMIN_PORT` before starting (see terminal error for hints).

### Security-related env (before exposing HTTPS)

| Variable | Purpose |
|----------|---------|
| `GATEHOUSE_PORTAL_CORS_ORIGINS` | Comma-separated allowed browser origins (default: localhost dev only) |
| `GATEHOUSE_PORTAL_PROJECT_DIRS` | Extra allowed `directory` roots besides `GATEHOUSE_PROJECT_DIR` |
| `GATEHOUSE_PORTAL_INTERNAL_TOKEN` | Shared secret for cross-process portal event injection |
| `GATEHOUSE_PORTAL_ADMIN_PORT` | Admin/control plane port (default `18472`, loopback only) |

### Status sync demo (Portal API ↔ UI only)

Isolate UI sync from OpenCode: a synthetic API cycles **idle → busy → research → idle → chat** every 3s.

**Terminal 1 — demo API (port 8797):**

```bash
cd packages/portal
GATEHOUSE_PROJECT_DIR=/path/to/project bun run demo:status-sync
```

**Terminal 2 — UI pointed at demo API:**

```bash
GATEHOUSE_PORTAL_API=http://127.0.0.1:8797 \
GATEHOUSE_PROJECT_DIR=/path/to/project \
GATEHOUSE_SNAPSHOT_POLL_MS=2000 \
bun run dev:ui
```

Simulates an **execution tree** (lead + 3 inner workers) plus four outer roles. Phases: bootstrap idle → kickoff → parallel busy → research → in-tree chat → wind-down → handoff chat. Inner agents **work at their bound cubicle** when busy/research and **wander the office** when idle; outer roles stay at dedicated boss desks. If the UI lags terminal 1 logs, the bug is Portal API ↔ Web UI (not OpenCode).

## Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Ensure assets exist + Vite dev server |
| `bun run build` | Production build to `dist/` |
| `bun run typecheck` | TypeScript check |
| `bun run import:office-layout` | Generate dynamic office layout (requires `GATEHOUSE_PROJECT_DIR`) |
| `bun run build:character-sheet-json` | Regenerate `sheets/{role}-1x1.json` from fixed grid layout |
| `bun run --cwd packages/character-assets generate:all` | **Local only**: synthesize 4 outer + 32 pool from LimeZu Character Generator, sync to `sheets/` |
| `bun run demo:status-sync` | Synthetic Portal API for status/UI sync debugging (no OpenCode) |

## Structure

```
index.html                 — portal shell (nav, blog, skills, office sidebar)
src/shell/                 — tabs, blog, skills, CSS, sidebar render
src/api/                   — snapshot types + fetch/poll
src/portal/state.ts        — in-memory snapshot + session→spawn lookup
src/office/game.ts         — Phaser bootstrap (office tab only)
src/scenes/OfficeScene.ts  — office map, bound cubicles, agents
src/pathfinding/astar.ts
src/bridge/events.ts       — OpenCode SSE via /portal/events
public/assets/
```

## Related

- Assets & licenses: [ASSETS.md](./ASSETS.md)
- Portal BFF: `packages/core/src/portal/`
