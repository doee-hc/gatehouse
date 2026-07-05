# @gatehouse/core

Minimal OpenCode plugin for the **lead × architect × curator × arbiter** outer team (gatehouse coordination tools + file conventions). Role **display names** are configured in `.gatehouse/config.yaml` (`agents.<profile>.name`); tool recipients and registry profiles stay `lead` / `architect` / `curator` / `arbiter`.

Architecture & workflow: project `.gatehouse/**/SKILL.md` prompts (scaffolded on first OpenCode start).

## Tools

| Tool | Purpose |
|------|---------|
| `gatehouse_init_team` | **profile lead** — register architect, curator, arbiter registry sessions (idempotent; first conversation) |
| `gatehouse_submit_orchestration` | **profile architect** — validate `mission.script.ts`, wake curator for skill_domain assignment (no exec sessions yet). Execution team is created inside `gatehouse_apply_skill_domains` |
| `gatehouse_list_team` | Team roster (no args): outer core team only — full mission roster for lead/architect/curator; arbiter includes `session_id` for permission correlation. Inner profiles cannot call this tool |
| `gatehouse_send_message` | Registry messaging; busy→queue in SQLite, idle/15s flush; send policy by sender scope |
| `gatehouse_session_snapshot` | **lead / architect / arbiter** — one-off diagnostic tail (≤50 lines) + `session_status`; not for polling |
| `gatehouse_apply_skill_domains` | **profile curator** — assign `skill_domain` and create execution team when no manifest yet |
| `gatehouse_mission_start` | **profile lead** — read queued entry from `missions.yaml`, freeze snapshot in `registry.db`, set `running`, notify architect |
| `gatehouse_mission_info` | **all roles except arbiter** — mission scope for the caller: boundaries, frozen contract, and own node brief (role-filtered) |
| `gatehouse_mission_retro` | **profile lead** — start retro after user confirms submitted delivery (requires all inner idle); fork retro sessions, dump `context/`, create isolated `build-extract` sessions for nodes with `skill_domain`, kickoff retro + skill-extract |
| `gatehouse_mission_complete` | **profile lead** — end mission (`done` or `cancelled`): abort inner/retro/extract/verify sessions, archive manifest, auto-notify architect + curator; on `done`, finalizes submitted delivery (records user feedback); pass `publish_deliverables=true` after user confirms Portal publish to publish `done_when` path deliverables; auto-publishes `.gatehouse/skills/by-domain/*/SKILL.md` to Portal on every `done` |
| `gatehouse_execution_complete` | **inner** — mark node done; orchestration terminal node auto-delivers to lead when all nodes done |
| `gatehouse_delivery_review` | **profile lead** — request revision or reject submitted delivery (deliverable publish is Lead opt-in on `mission_complete(done, publish_deliverables=true)`) |
| `gatehouse_unpublish_blog` | **profile lead** — remove a published Portal post by `report_path` (corrections only; publish is system-managed) |
| `gatehouse_retro_record` | Retro session marks report done in registry; when all complete, auto-notifies **profile architect** |
| `gatehouse_retro_summary_record` | **profile architect** — register `architect-summary.md`; when retro summaries are complete, auto-notifies **profile lead** |
| `gatehouse_skill_extract_record` | **build-extract** session only — runs quality gates, records extract completion; when all nodes complete, auto-starts verify sessions |
| `gatehouse_skill_verify_record` | **build-verify** session only — programmatic + agent verification; when all nodes pass, auto-notifies **profile curator** |
| `gatehouse_skill_summary_record` | **profile curator** — register `curator-summary.md`; when retro summaries are complete, auto-notifies **profile lead** |
| `gatehouse_inspector_queue` | **profile arbiter** — list pending permission requests |
| `gatehouse_inspector_decide` | **profile arbiter** — approve (`once` / `always`) or reject a permission request |
| `gatehouse_execution_rework` | **inner** — reopen a dependency node (in-flight rework) |
| `gatehouse_execution_status` | **lead / architect** — read orchestration runtime state (architect: stall diagnosis only) |
| `gatehouse_direction_status` | **profile lead** — read `.gatehouse/lead/direction.yaml` |

Everything else (missions queue, reports, skills) uses OpenCode **read/write** + SKILL prompts under `.gatehouse/`. Portal: domain skills auto-publish on `gatehouse_mission_complete(done)`; deliverables publish only when Lead passes `publish_deliverables=true`; retro `retro-summary.md` and `architect-summary.md` auto-publish to Portal under the mission when registered via `gatehouse_retro_record` / `gatehouse_retro_summary_record`.

**Autopilot:** user toggles with **TUI** `/autopilot` (picker or `/autopilot-on` / `/autopilot-off`) or **IM** `/autopilot on|off`. When ON and `direction.yaml` is `status: confirmed`, if the lead session is idle, the last message is from the assistant, and the user has not replied for **10 minutes**, Gatehouse delivers `prompts/lead/autopilot-wake.md` — full delegation; Lead proceeds without asking the user. User messages reset the idle timer. TUI sidebar shows autopilot + direction status (read-only).

Personnel registry (outer + inner + retro + extract + verify agents ↔ OpenCode `session_id`) and **mission manifests** (`manifest` / `retro-manifest` / `extract-manifest` / `verify-manifest`) live in **`.gatehouse/registry.db`** (SQLite). Frozen mission contract, node briefs, orchestration state, and delivery records are also stored in `registry.db`; agents read them via `gatehouse_mission_*` / `gatehouse_execution_*` tools — not plaintext under `.gatehouse/missions/`. Optional exports for human inspection live under **`.gatehouse/internal/exports/missions/<mission_id>/`**. Architects author **`.gatehouse/missions/<mission_id>/mission.script.ts`** (`export const team` + `orchestrate`); `gatehouse_submit_orchestration` validates the script and kicks off orchestration. Node briefs are written via `ctx.run(..., { brief: ... })` during orchestration and stored in `registry.db`. `gatehouse_send_message` resolves recipients and enforces who may message whom; OpenCode `task` child sessions for lead/architect are disabled. **Lead should call `gatehouse_init_team` on first conversation** to register architect/curator/arbiter; thereafter `send_message` and architect `gatehouse_submit_orchestration` require registered targets. Curator `apply_skill_domains` creates Mission execution sessions.

**Delivery queue:** if the recipient session is `busy` or `retry`, the prompt is appended to `registry_pending_delivery` and the tool returns `delivery: queued`. The plugin flushes the FIFO queue when OpenCode emits `session.status: idle` for that session, and every 15s as a fallback.

**Watchdog:** while a mission is `running` with orchestration state (no retro fork), the plugin polls every 2s; for each node marked `running` or `rework` in orchestration whose session stays `idle` for 10s, it wakes **that node** with `prompts/architect/watchdog-node-wake.md` (30s per-node cooldown). Watchdog **pauses** after the orchestration terminal node delivery notification to lead (awaiting reply) and **resumes** on `send_message` from lead to a tree member (`recipient=<node_id>` or inner session).

**Retro / skill record watchdogs:** four independent pollers (same 2s / 10s idle / 30s cooldown). While `gatehouse_retro_record`, `gatehouse_skill_extract_record`, or `gatehouse_skill_verify_record` completions are still pending, if **all** expected retro, extract, or verify sessions are idle for 10s, Gatehouse notifies each **pending** agent with `watchdog-retro-record-wake.md`, `watchdog-skill-record-wake.md`, or `watchdog-skill-verify-record-wake.md` to finish and call the record tool.

**Autopilot watchdog:** polls every 30s when `/autopilot` is ON and direction is confirmed. See **Autopilot** above.

## Enable (global plugin — no per-project install)

Recommended one-time global setup:

```bash
bunx @gatehouse/core install
bunx @gatehouse/core doctor --global-only
```

Project setup (pick one):

```bash
bunx @gatehouse/core scaffold -C /path/to/project
cd /path/to/project && opencode
```

Other lifecycle commands: `upgrade`, `uninstall`, `doctor --probe`.

The installer writes `~/.config/opencode/opencode.jsonc`, `tui.json`, agent definitions, and `~/.config/gatehouse/config.yaml`. Models are not configured during install — edit `config.yaml` if needed.

Monorepo dev uses `bun run dev` (local `file://` plugin in the **project** config). See [docs/PUBLISH.md](./docs/PUBLISH.md).

## Start a Mission with lead

1. Run `bun run dev` in this repo (project `opencode.jsonc` + global agents)
2. New session — default agent is **lead** (display name from `config.yaml`, e.g. Len)
3. Lead calls `gatehouse_init_team` to register architect, curator, arbiter
4. Discuss direction with lead, confirm Mission; write full fields in `missions.yaml` (`status: queued`)
5. After user confirms, lead calls `gatehouse_mission_start(mission_id=...)` (freezes registry snapshot, `running`, auto-notifies architect)

## Scaffold project layout (manual, monorepo)

```bash
bun run --cwd packages/core scaffold /path/to/project
```

Forces an early `.gatehouse/` + project `file://` plugin entries (normally the plugin does this on first OpenCode start).

## Start OpenCode from any directory (recommended)

From the gatehouse repo root:

```bash
bun run dev ../test              # open ../test as project root
bun run dev ../test --port 4096  # fixed port (also supports --port 4096 ../test)
bun run dev /path/to/project
```

Before startup: `prepareGatehouseProject` → isolated `.gatehouse` + plugin config.

**Gatehouse Portal:** display API defaults to `18471` (read-only + SSE + UI); Admin control plane defaults to `18472` (`/admin`, Channel API, loopback only). After `bun run build`, UI is static `dist/portal/`; during monorepo dev, `bun run dev` embeds Vite middleware on `18471` (HMR). Disable: `GATEHOUSE_PORTAL=0`.

## IM Channels

Unified CLI + Supervisor for WeChat / Feishu / QQ. Start OpenCode first (`bun run dev <project>`), then:

```bash
bun run channels init -C /path/to/project      # writes .gatehouse/channels.yaml + channels plugin in opencode.jsonc
bun run channels login weixin                  # or feishu / qq
bun run channels serve -C /path/to/project     # one supervisor for all enabled channels
bun run channels status --probe
bun run channels stop -C /path/to/project
```

User guide: [docs/guide/channels.md](../../docs/guide/channels.md) · [docs/guide/channels.zh.md](../../docs/guide/channels.zh.md). Platform setup: [weixin](../weixin-bridge/README.md) / [feishu](../feishu-bridge/README.md) / [qq](../qq-bridge/README.md). Monorepo source: [`src/channels/`](./src/channels/). Legacy `bun run dev:weixin-bridge` still works.

**Note:** You must pass the **project directory** to the dev script (as above) so OpenCode loads config from the correct cwd; `--port` and the project path can be in either order.

Creates `.gatehouse/` with:

- `skills/lead-meta/SKILL.md`（skill id: `lead-meta`）+ empty `missions.yaml`
- `skills/architect-meta/SKILL.md`（`architect-meta`）+ `prompts/architect/` templates
- `skills/retro-toolkit/` — shared retro analysis tools (skill + scripts)
- `skills/curator-meta/SKILL.md`（`curator-meta`）+ `prompts/curator/` skill assignment / summary prompts
- `skills/arbiter-meta/SKILL.md`（`arbiter-meta`）
- `config.yaml` — global `~/.config/gatehouse/config.yaml` + project `.gatehouse/config.yaml` (Portal brand, ICP, **outer team display names**, per-role `models`)
- `skills/by-domain/` + `skills/domains.yaml` (curator assigns domains after orchestration submit; Gatehouse creates extract/verify sessions and delivers skill prompts on retro)
- empty `missions/` (mission artifacts written after lead confirms)

## Example smoke mission (core-example-smoke-v1)

Lightweight smoke fixture at **`test/fixtures/core-example-smoke-v1/mission.script.ts`** (not written to user projects on init). `bun test` copies this fixture temporarily for collaboration script parsing and mock submit_orchestration.

```bash
bun run --cwd packages/core test
```

Manual OpenCode smoke: copy `test/fixtures/core-example-smoke-v1/mission.script.ts` to `.gatehouse/missions/core-example-smoke-v1/`, start the mission in `missions.yaml`, then run architect submit_orchestration → curator apply_skill_domains.
