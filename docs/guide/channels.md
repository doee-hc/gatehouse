# IM Channels (WeChat / Feishu / QQ)

Chat with your team remotely via WeChat, Feishu, or QQ. Inbound messages route to the bound registry agent (default Lead); assistant replies are delivered when the OpenCode session goes idle. Agents can queue outbound files with `gatehouse_channels_send_file`.

Run `channels init` once per project, then restart OpenCode so the channels plugin and tools load.

## Prerequisites

1. `@gatehouse/core` installed globally (`opencode plug @gatehouse/core --global` or `bunx @gatehouse/core install`)
2. OpenCode running in a Gatehouse project (`.gatehouse/` present)
3. Platform credentials (WeChat iLink, Feishu app, or QQ bot)

## CLI

From any directory (recommended: pass `-C /path/to/project`):

```bash
bunx @gatehouse/core channels init [-C project]
bunx @gatehouse/core channels login <weixin|feishu|qq|qq-onebot>
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

## Platform setup

| Platform | Guide |
| --- | --- |
| WeChat | [packages/weixin-bridge/README.md](../../packages/weixin-bridge/README.md) |
| Feishu | [packages/feishu-bridge/README.md](../../packages/feishu-bridge/README.md) |
| QQ (official DM) | [packages/qq-bridge/README.md](../../packages/qq-bridge/README.md) |
| QQ group (NapCat / OneBot) | [packages/qq-onebot-bridge/README.md](../../packages/qq-onebot-bridge/README.md) |

## Agent ↔ IM

- Inbound messages route to the user's bound registry agent (default `outer:lead`); use `/agent` in IM to switch targets.
- Outbound assistant text is relayed when the bound OpenCode session goes idle.
- Agents call `gatehouse_channels_send_file` with a project-relative path to queue an image/file for IM delivery.

## See also

- [Getting Started — IM Channels](../getting-started.md#im-channels)
- [packages/core/README.md — IM Channels](../../packages/core/README.md#im-channels)
- [Developer guide](../dev.md)
