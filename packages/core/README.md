# @gatehouse/core

Minimal OpenCode plugin for the **lead × architect × curator × arbiter** outer team (gatehouse coordination tools + file conventions). Role **display names** are configured in `.gatehouse/config.yaml` (`agents.<profile>.name`); tool recipients and registry profiles stay `lead` / `architect` / `curator` / `arbiter`.

Architecture & workflow: project `.gatehouse/**/SKILL.md` prompts (scaffolded on first OpenCode start).

## Tools

| Tool | Purpose |
|------|---------|
| `gatehouse_init_team` | **profile lead** — register architect, curator, arbiter registry sessions (idempotent; first conversation) |
| `gatehouse_bootstrap_tree` | **profile architect** — validate `mission.script.ts`, wake curator for skill_domain assignment (no exec sessions yet). Execution tree is created inside `gatehouse_apply_skill_domains` |
| `gatehouse_list_team` | Team roster (no args): outer sees full mission roster; inner root sees lead + execution; inner leaf sees all execution; retro sees subtree only; arbiter includes `session_id` |
| `gatehouse_send_message` | Registry messaging; busy→queue in SQLite, idle/15s flush; send policy by sender scope |
| `gatehouse_session_snapshot` | Read-only diagnostic tail (≤50 lines) + `session_status`; one-off check only — not for polling while waiting for replies |
| `gatehouse_apply_skill_domains` | **profile curator** — assign `skill_domain` and bootstrap execution team when no manifest yet |
| `gatehouse_mission_start` | **profile lead** — read queued entry from `missions.yaml`, freeze snapshot in `registry.db`, set `running`, notify architect |
| `gatehouse_mission_current` | **lead / architect / curator** — full active mission contract from registry snapshot |
| `gatehouse_mission_retro` | **profile lead** — start retro after user confirms submitted delivery (requires all inner idle); fork retro sessions, dump `context/`, kickoff retro + skill-extract |
| `gatehouse_mission_complete` | **profile lead** — end mission (`done` or `cancelled`): abort all inner/retro sessions, archive manifest, auto-notify architect + curator; on `done`, finalizes submitted delivery (records user feedback + publishes `done_when publish:` deliverables) and auto-publishes `.gatehouse/skills/by-domain/*/SKILL.md` to Portal |
| `gatehouse_delivery_submit` | **structural root** — submit delivery; records `pending_publish_paths` (does not publish to Portal) |
| `gatehouse_delivery_review` | **profile lead** — request revision or reject submitted delivery (publish happens on `mission_complete(done)`) |
| `gatehouse_delivery_status` | Read structured delivery record (lead, architect, structural root) |
| `gatehouse_unpublish_blog` | **profile lead** — remove a published Portal post by `report_path` (corrections only; publish is system-managed) |
| `gatehouse_retro_record` | Retro session marks report done in registry; when all complete, auto-notifies **profile architect** |
| `gatehouse_skill_extract_record` | Exec session marks skill extract done; when all complete, auto-notifies **profile curator** |
| `gatehouse_inspector_queue` | **profile arbiter** — list pending permission requests |
| `gatehouse_inspector_decide` | **profile arbiter** — approve (`once` / `always`) or reject a permission request |
| `gatehouse_execution_complete` | **inner** — mark node done; orchestration unblocks waiting nodes |
| `gatehouse_execution_rework` | **inner** — reopen a dependency node (in-flight rework) |
| `gatehouse_execution_status` | **lead / architect / root / coordinators** — read orchestration runtime state |
| `gatehouse_mission_context` | **execution + lead / architect** — shared objective & must_not boundaries |
| `gatehouse_node_brief` | **execution + lead / architect** — node brief (your_work / acceptance_slice); leaves read own node only |
| `gatehouse_mission_contract` | **coordinators + lead / architect** — frozen contract from registry; inner leaves get summary view |

Everything else (missions queue, reports, skills) uses OpenCode **read/write** + SKILL prompts under `.gatehouse/`. Portal blog posts are system-managed on `gatehouse_mission_complete(done)` (deliverables + domain skills).

Personnel registry (outer + inner + retro agents ↔ OpenCode `session_id`) and **execution-tree manifests** (`manifest` / `retro-manifest`) live in **`.gatehouse/registry.db`** (SQLite). Frozen mission contract, node briefs, and orchestration state are also stored in `registry.db`; agents read them via `gatehouse_mission_*` / `gatehouse_execution_*` tools — not plaintext under `.gatehouse/trees/`. Optional exports for human inspection live under **`.gatehouse/internal/exports/trees/<mission_id>/`**. Architects author **`.gatehouse/trees/<mission_id>/mission.script.ts`** (`export const team` + `orchestrate`); bootstrap starts orchestration from the script. Node briefs are written via `ctx.setBrief` during orchestration and stored in `registry.db`. `gatehouse_send_message` resolves recipients and enforces who may message whom; OpenCode `task` child sessions for lead/architect are disabled. **Lead should call `gatehouse_init_team` on first conversation** to register architect/curator/arbiter; thereafter `send_message` and architect `gatehouse_bootstrap_tree` require registered targets. Curator `apply_skill_domains` creates Mission execution sessions.

**Delivery queue:** if the recipient session is `busy` or `retry`, the prompt is appended to `registry_pending_delivery` and the tool returns `delivery: queued`. The plugin flushes the FIFO queue when OpenCode emits `session.status: idle` for that session, and every 15s as a fallback.

**Execution watchdog:** while a mission is `running` with orchestration state (no retro fork), the plugin polls every 2s; for each node marked `running` or `rework` in orchestration whose session stays `idle` for 10s, it wakes **that node** with `prompts/architect/watchdog-node-wake.md` (30s per-node cooldown). Watchdog **pauses** after the structural root `gatehouse_send_message`s lead (awaiting reply) and **resumes** on any `send_message` to a tree member (`recipient=<node_id>` or inner session).

**Retro / skill record watchdogs:** two independent pollers (same 2s / 10s idle / 30s cooldown). While `gatehouse_retro_record` or `gatehouse_skill_extract_record` completions are still pending, if **all** expected retro or exec sessions are idle for 10s, Gatehouse notifies each **pending** agent with `watchdog-retro-record-wake.md` or `watchdog-skill-record-wake.md` to finish and call the record tool.

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

## 在任意目录启动 OpenCode（推荐）

在 gatehouse 仓库根目录：

```bash
bun run dev ../test              # 打开 ../test 作为项目根
bun run dev ../test --port 4096  # 固定端口（也支持 --port 4096 ../test）
bun run dev /path/to/project
```

启动前会自动：`prepareGatehouseProject` → 独立 `.gatehouse` + 插件配置。

**Gatehouse Portal：** 展示 API 默认 `18471`（只读 + SSE + UI）；Admin 控制面默认 `18472`（`/admin`、Channel API，仅 loopback）。`bun run build` 后 UI 为静态 `dist/portal/`；Monorepo 开发时 `bun run dev` 在 `18471` 嵌入 Vite middleware（HMR）。关闭：`GATEHOUSE_PORTAL=0`。

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

**注意：** 必须把**项目目录**传给 dev 脚本（如上），OpenCode 才会在正确 cwd 下加载配置；`--port` 与项目路径顺序可互换。

Creates `.gatehouse/` with:

- `skills/lead-meta/SKILL.md`（skill id: `lead-meta`）+ empty `missions.yaml`
- `skills/architect-meta/SKILL.md`（`architect-meta`）+ `prompts/architect/` templates
- `skills/retro-toolkit/` — shared retro analysis tools (skill + scripts)
- `skills/curator-meta/SKILL.md`（`curator-meta`）+ `prompts/curator/` skill assignment / rollup prompts
- `skills/arbiter-meta/SKILL.md`（`arbiter-meta`）
- `config.yaml` — global `~/.config/gatehouse/config.yaml` + project `.gatehouse/config.yaml` (Portal brand, ICP, **outer team display names**, per-role `models`)
- `skills/by-domain/` + `skills/domains.yaml` (curator assigns domains after bootstrap; Gatehouse delivers skill-extract prompts on retro)
- empty `trees/`, `trees-index.yaml` (missions written after lead confirms)

## 测试用示例任务（core-example-smoke-v1）

轻装 smoke 样例在 **`test/fixtures/core-example-smoke-v1/mission.script.ts`**（不随项目初始化写入用户项目）。`bun test` 会临时复制该 fixture 做协作脚本解析与 mock bootstrap。

```bash
bun run --cwd packages/core test
```

手动 OpenCode smoke：将 `test/fixtures/core-example-smoke-v1/mission.script.ts` 复制到 `.gatehouse/trees/core-example-smoke-v1/`，在 `missions.yaml` 中启动任务后走 architect → curator bootstrap 流程。

## Legacy

Org OS（`gatehouse-plugin`、eval、EDA）仅在 **`dev`** 分支维护；本仓库不包含上述代码。
