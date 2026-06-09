# IM Channels (WeChat / Feishu / QQ)

IM channel support ships **inside `@gatehouse/core`**. There is no separate channels npm package.

| Surface | Value |
| --- | --- |
| npm package | `@gatehouse/core` |
| Library import | `@gatehouse/core/channels` |
| OpenCode plugin (project) | `@gatehouse/core/channels/plugin` |
| Source (monorepo) | [`packages/core/src/channels/`](../../packages/core/src/channels/) |
| Agent tool | `gatehouse_channels_send_file` |

`channels init` / `channels serve` writes `@gatehouse/core/channels/plugin` into the **project** root `opencode.jsonc` alongside `@gatehouse/core`. Restart OpenCode after the first write so the tool loads.

## Prerequisites

1. `@gatehouse/core` installed globally (`opencode plug @gatehouse/core --global` or `bunx @gatehouse/core install`)
2. OpenCode running in a Gatehouse project (`.gatehouse/` present)
3. Platform credentials (WeChat iLink, Feishu app, or QQ bot)

## CLI

From any directory (recommended: pass `-C /path/to/project`):

```bash
bunx @gatehouse/core channels init [-C project]
bunx @gatehouse/core channels login <weixin|feishu|qq>
bunx @gatehouse/core channels serve [-C project]
bunx @gatehouse/core channels status [--probe]
bunx @gatehouse/core channels stop [-C project]
bunx @gatehouse/core channels doctor [--probe]
```

Monorepo shorthand (from repository root):

```bash
bun run channels init -C /path/to/project
bun run channels login weixin
bun run channels serve -C /path/to/project
```

Typical flow: start OpenCode in the project (`bun run dev <project>` or `opencode`), then run `channels serve` in another terminal.

## Configuration & state

| Path | Purpose |
| --- | --- |
| `.gatehouse/channels.yaml` | Enabled channels and platform credentials |
| `.gatehouse/channels/<platform>/` | Per-platform state (sessions, dedup, credentials) |
| `.gatehouse/channels/outbound/` | Pending file attachments from `gatehouse_channels_send_file` |
| `.gatehouse/registry.db` | Authoritative agent → OpenCode session mapping |

Portal channel admin (optional): `http://127.0.0.1:18472/admin` — unlock with `portal.admin_key` from `.gatehouse/config.yaml`.

## Platform bridges

End users do **not** need separate bridge npm packages; `@gatehouse/core` bundles bridge entrypoints at build time. Monorepo developers may run platform packages directly:

| Platform | Doc |
| --- | --- |
| WeChat | [packages/weixin-bridge/README.md](../../packages/weixin-bridge/README.md) |
| Feishu | [packages/feishu-bridge/README.md](../../packages/feishu-bridge/README.md) |
| QQ | [packages/qq-bridge/README.md](../../packages/qq-bridge/README.md) |

Bridge packages depend on `@gatehouse/core` and import shared logic from `@gatehouse/core/channels`.

## Agent ↔ IM

- Inbound messages route to the user's bound registry agent (default `outer:lead`); use `/agent` in IM to switch targets.
- Outbound assistant text is relayed when the bound OpenCode session goes idle.
- Agents call `gatehouse_channels_send_file` with a project-relative path to queue an image/file for IM delivery.

## See also

- [Getting Started — IM Channels](../getting-started.md#im-channels-optional)
- [packages/core/README.md — IM Channels](../../packages/core/README.md#im-channels)
- [Developer guide](../dev.md)
