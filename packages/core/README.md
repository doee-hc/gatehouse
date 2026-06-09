# @gatehouse/core

Minimal OpenCode plugin for the **lead × architect × curator × arbiter** outer team (fourteen tools + file conventions). Role **display names** are configured in `.gatehouse/config.yaml` (`agents.<profile>.name`); tool recipients and registry profiles stay `lead` / `architect` / `curator` / `arbiter`.

Architecture & workflow: project `.gatehouse/**/SKILL.md` prompts (scaffolded on first OpenCode start).

## Tools

| Tool | Purpose |
|------|---------|
| `gatehouse_init_team` | **profile lead** — register architect, curator, arbiter registry sessions (idempotent; first conversation) |
| `gatehouse_bootstrap_tree` | **profile architect** — validate TeamSpec, wake curator for skill_domain assignment (no exec sessions yet). Execution tree is created inside `gatehouse_apply_skill_domains` |
| `gatehouse_list_team` | Team roster (no args): outer sees full mission roster; inner root sees lead + execution; inner leaf sees all execution; retro sees subtree only; arbiter includes `session_id` |
| `gatehouse_send_message` | Registry messaging; busy→queue in SQLite, idle/15s flush; send policy by sender scope |
| `gatehouse_session_snapshot` | Read-only diagnostic tail (≤50 lines) + `session_status`; one-off check only — not for polling while waiting for replies |
| `gatehouse_apply_skill_domains` | **profile curator** — fill teamspec `skill_domain` and bootstrap execution team when no manifest yet |
| `gatehouse_mission_start` | **profile lead** — read queued entry from `missions.yaml`, freeze snapshot in `registry.db`, set `running`, notify architect |
| `gatehouse_mission_current` | **lead / architect / curator** — full active mission contract from registry snapshot |
| `gatehouse_mission_retro` | **profile lead** — start retro after acceptance (requires all inner idle); fork retro sessions, dump `context/`, kickoff retro + skill-extract |
| `gatehouse_mission_complete` | **profile lead** — end mission (`done` or `cancelled`): abort all inner/retro sessions, archive manifest, auto-notify architect + curator |
| `gatehouse_retro_record` | Retro session marks report done in registry; when all complete, auto-notifies **profile architect** |
| `gatehouse_skill_extract_record` | Exec session marks skill extract done; when all complete, auto-notifies **profile curator** |
| `gatehouse_publish_blog` | Publish a report/skill markdown to Portal blog UI (`report_path` only; `.gatehouse/portal/blog-published.yaml`; unpublished files stay hidden) |
| `gatehouse_unpublish_blog` | Remove a published post from Portal blog (`report_path`; only the original publisher, per `published_by`) |

Everything else (missions queue, reports, skills) uses OpenCode **read/write** + SKILL prompts under `.gatehouse/`. Portal blog only shows posts after `gatehouse_publish_blog`.

Personnel registry (outer + inner + retro agents ↔ OpenCode `session_id`) and **execution-tree manifests** (`manifest` / `retro-manifest`) live in **`.gatehouse/registry.db`** (SQLite). Plugin code reads trees from the DB only. Optional YAML exports for human inspection live under **`.gatehouse/internal/exports/trees/<mission_id>/`** — inner agents must use `gatehouse_list_team()`, not these files. `trees/<mission_id>/` holds authoring (`teamspec.yaml`) and reports only. `gatehouse_send_message` resolves recipients and enforces who may message whom; OpenCode `task` child sessions for lead/architect are disabled. **Lead should call `gatehouse_init_team` on first conversation** to register architect/curator/arbiter; thereafter `send_message` and architect `gatehouse_bootstrap_tree` require registered targets. Curator `apply_skill_domains` creates Mission execution sessions.

**Delivery queue:** if the recipient session is `busy` or `retry`, the prompt is appended to `registry_pending_delivery` and the tool returns `delivery: queued`. The plugin flushes the FIFO queue when OpenCode emits `session.status: idle` for that session, and every 15s as a fallback.

**Execution-tree watchdog:** while a mission is `running` (no retro fork), the plugin polls every 2s; if **all** execution-tree sessions stay `idle` for 10s, it wakes the structural root with `prompts/architect/watchdog-root-wake.md` (multi-node) or `watchdog-root-wake-solo.md` (solo root) to unblock stalled work (30s cooldown between wakes). Watchdog **pauses** after the structural root `gatehouse_send_message`s lead (awaiting reply) and **resumes** on any `send_message` to a tree member (`recipient=<node_id>` or inner session).

**Retro / skill record watchdogs:** two independent pollers (same 2s / 10s idle / 30s cooldown). While `gatehouse_retro_record` or `gatehouse_skill_extract_record` completions are still pending, if **all** expected retro or exec sessions are idle for 10s, Gatehouse notifies each **pending** agent with `watchdog-retro-record-wake.md` or `watchdog-skill-record-wake.md` to finish and call the record tool.

## Enable (global plugin — no per-project install)

Register once in **global** OpenCode config (pick one):

```bash
opencode plug @gatehouse/core --global
```

```jsonc
// ~/.config/opencode/opencode.jsonc
{
  "plugin": ["@gatehouse/core"]
}
```

```jsonc
// ~/.config/opencode/tui.json (TUI client guard — package root; OpenCode resolves exports["./tui"])
{
  "plugin": ["@gatehouse/core"]
}
```

Optional helper (registers plugin + optional global config): `bunx @gatehouse/core install`

Verify: `bunx @gatehouse/core doctor`

Then **start OpenCode in your project directory**. The plugin automatically:

- scaffolds `.gatehouse/` (project-owned files are not overwritten)
- syncs Gatehouse agent definitions to `~/.config/opencode/agent/`
- merges project root `opencode.jsonc` with `default_agent: lead` and `skills.paths: [".gatehouse"]`

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

**IM Channels (WeChat / Feishu / QQ):** unified CLI + Supervisor. Start OpenCode first (`bun run dev <project>`), then:

```bash
bun run channels init -C /path/to/project      # writes .gatehouse/channels.yaml + @gatehouse/core/channels/plugin in opencode.jsonc
bun run channels login weixin                  # or feishu / qq
bun run channels serve -C /path/to/project     # one supervisor for all enabled channels
bun run channels status --probe
bun run channels stop -C /path/to/project
```

User guide: [docs/guide/channels.md](../../docs/guide/channels.md) · [docs/guide/channels.zh.md](../../docs/guide/channels.zh.md)

Platform bridge packages ([weixin](../weixin-bridge/README.md) / [feishu](../feishu-bridge/README.md) / [qq](../qq-bridge/README.md)) depend on `@gatehouse/core` and import `@gatehouse/core/channels`. Legacy `bun run dev:weixin-bridge` still works in the monorepo.

## IM Channels

IM logic lives in [`src/channels/`](./src/channels/) and ships as:

| Surface | Value |
| --- | --- |
| Import | `@gatehouse/core/channels` |
| OpenCode plugin (project) | `@gatehouse/core/channels/plugin` |
| Extra agent tool | `gatehouse_channels_send_file` (queue outbound files to IM) |

`channels init` / `ensureOpencodeConfig` adds the channels plugin to project `opencode.jsonc`. End-user bridges are bundled under `bridges/` at build time — separate `@gatehouse/*-bridge` npm installs are not required.

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

轻装 smoke 样例在 **`test/fixtures/core-example-smoke-v1/`**（不随项目初始化写入用户项目）。`bun test` 会临时复制该 fixture 做 TeamSpec 解析与 mock bootstrap。

```bash
bun run --cwd packages/core test
```

手动 OpenCode smoke：将 `test/fixtures/core-example-smoke-v1/` 复制到项目的 `.gatehouse/trees/`，再按 fixture 内 `missions.yaml` 走任务流程。

## Legacy

Org OS（`gatehouse-plugin`、eval、EDA）仅在 **`dev`** 分支维护；本仓库不包含上述代码。
