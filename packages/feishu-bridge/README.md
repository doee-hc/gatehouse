# Gatehouse Feishu Bridge

Bridges Feishu Bot DMs (and group @mentions) to Gatehouse registry agent sessions (default `outer:lead`).

Protocol reference: Feishu WebSocket long-connection from [opencode-im-bridge](https://github.com/ET06731/opencode-im-bridge). Gatehouse integration in [`@gatehouse/channels-core`](../channels-core/README.md).

## Prerequisites

1. Gatehouse project initialized (`.gatehouse/`)
2. OpenCode running in the project directory (with `@gatehouse/core` plugin)

**Recommended:** `bun run channels login feishu` → `bun run channels serve -C <project>`

```bash
# Terminal 1
bun run dev /path/to/your-project --port 4096
```

## Feishu Open Platform Setup

1. Create an enterprise self-built app; obtain **App ID** / **App Secret**
2. Permissions (tenant): `im:message`, `im:message.p2p_msg:readonly`; for groups add `im:message.group_at_msg:readonly`
3. **Start this bridge first**, then in the console under Event Subscription choose **long connection** and subscribe to `im.message.receive_v1`

## Configuration

```bash
cp packages/feishu-bridge/.env.example packages/feishu-bridge/.env
```

| Variable | Description |
|----------|-------------|
| `GATEHOUSE_PROJECT_DIR` | Project root containing `.gatehouse/` |
| `OPENCODE_URL` | OpenCode HTTP URL |
| `FEISHU_APP_ID` | Feishu App ID |
| `FEISHU_APP_SECRET` | Feishu App Secret |

State directory: `.gatehouse/channels/feishu/`

## Run

```bash
bun run dev:feishu-bridge
```

## MVP Limitations

- **Text + images**; files/voice show unsupported message
- Agents can use **`gatehouse_channels_send_file`** to send project images back to Feishu
- Group chat requires @mention (depends on Feishu event subscription config)
- Blocks until agent reply, then sends full response

## Commands

- `/agent` — list switchable agents
- `/agent outer:lead` — switch conversation target
