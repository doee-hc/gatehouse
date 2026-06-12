# Gatehouse QQ Bridge

Bridges QQ official Bot **DMs** to Gatehouse registry agent sessions (default `outer:lead`).

WebSocket integration reference: [opencode-im-bridge](https://github.com/ET06731/opencode-im-bridge) (`qq-official-bot` SDK). Gatehouse setup: [IM Channels guide](../../docs/guide/channels.md).

## Prerequisites

1. Gatehouse project initialized (`.gatehouse/`)
2. OpenCode running in the project directory

**Recommended:** `bun run channels login qq` → `bun run channels serve -C <project>`

```bash
# Terminal 1
bun run dev /path/to/your-project --port 4096
```

## QQ Open Platform Setup

1. Create a Bot app on [QQ Open Platform](https://q.qq.com/)
2. Obtain **AppID** and **ClientSecret**
3. Enable DM capabilities and `C2C_MESSAGE_CREATE` event

## Configuration

```bash
cp packages/qq-bridge/.env.example packages/qq-bridge/.env
```

| Variable | Description |
|----------|-------------|
| `GATEHOUSE_PROJECT_DIR` | Project root containing `.gatehouse/` |
| `OPENCODE_URL` | OpenCode HTTP URL |
| `QQ_APP_ID` | QQ Bot AppID |
| `QQ_SECRET` | QQ Bot ClientSecret |
| `QQ_SANDBOX` | Sandbox mode (default `true`) |

State directory: `.gatehouse/channels/qq/`

## Run

```bash
bun run dev:qq-bridge
```

## MVP Limitations

- Official Bot **DM text + images**
- Agents can use **`gatehouse_channels_send_file`** to send project images back to QQ
- Files/voice/video show unsupported message
- QQ group chat: use [`qq-onebot-bridge`](../qq-onebot-bridge/README.md) (NapCat + OneBot V11) alongside this package for official private DMs

## Commands

- `/agent` — list switchable agents
- `/agent outer:lead` — switch conversation target
