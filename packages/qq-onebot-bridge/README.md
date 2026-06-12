# Gatehouse QQ OneBot Bridge

Bridges **QQ group chat** via NapCat (OneBot V11) to Gatehouse registry agent sessions. Use alongside the official [`qq-bridge`](../qq-bridge/README.md) for private DMs.

## Architecture

```
QQ 群消息 ←→ NapCat (OneBot V11 WS) ←→ Gatehouse qq-onebot-bridge ←→ OpenCode
QQ 私聊   ←→ QQ 官方 Bot (qq-bridge)  ←→ Gatehouse
```

## Prerequisites

1. Gatehouse project with `.gatehouse/`
2. OpenCode running in the project directory
3. [NapCat](https://github.com/NapNeko/NapCatQQ) deployed and logged in
4. NapCat **正向 WebSocket** enabled (default port `3001`)

## NapCat setup

1. Start NapCat (Docker or native) and scan QR to log in
2. Open NapCat WebUI → **网络配置** → enable **正向 WebSocket**
3. Note the WS URL and optional Access Token

## Configuration

```bash
bun run channels login qq-onebot -C <project>
```

Or edit `.gatehouse/channels.yaml`:

```yaml
channels:
  qq-onebot:
    enabled: true
    wsUrl: "ws://127.0.0.1:3001"
    accessToken: ""
    requireAt: true
    groupAllowList: []   # empty = all groups; or ["123456789"]
```

| Variable | Description |
|----------|-------------|
| `QQ_ONEBOT_WS_URL` | NapCat forward WebSocket URL |
| `QQ_ONEBOT_ACCESS_TOKEN` | Optional access token |
| `QQ_ONEBOT_REQUIRE_AT` | Only reply when @ bot (default `true`) |
| `QQ_ONEBOT_GROUP_ALLOWLIST` | Comma-separated group IDs |

State directory: `.gatehouse/channels/qq-onebot/`

## Run

```bash
# With channels supervisor (recommended)
bun run channels serve -C <project>

# Dev only
bun run dev:qq-onebot-bridge
```

## Behavior

- **Group only** — private chat stays on official `qq-bridge`
- Session key: `group:{groupId}:user:{userId}` (per-user context in each group)
- Supports text, images, `/agent` commands
- Agents can send images back via `gatehouse_channels_send_file`

## Commands

- `/agent` — list switchable agents
- `/agent outer:lead` — switch conversation target
