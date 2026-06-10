# Gatehouse WeChat Bridge (iLink → Registry Agent)

Bridges WeChat iLink Bot API to OpenCode sessions registered in `.gatehouse/registry.db` (default `outer:lead`).

## Prerequisites

1. Gatehouse project initialized (`.gatehouse/`, `default_agent: lead`)
2. OpenCode running in the project directory (with `@gatehouse/core` plugin)

**Recommended:** Use the unified CLI (Supervisor)

```bash
# Terminal 1
bun run dev /path/to/your-project --port 4096

# Terminal 2 (from gatehouse repo root)
bun run channels init -C /path/to/your-project
bun run channels login weixin
bun run channels serve -C /path/to/your-project
```

Legacy single-package `.env` flow still works — see **Configuration** below.

## Configuration

Copy `.env.example` to `.env` and fill in values:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `GATEHOUSE_PROJECT_DIR` | Gatehouse project root (contains `.gatehouse/`) |
| `OPENCODE_URL` | OpenCode HTTP URL, default `http://127.0.0.1:4096` |
| `WIXIN_ILINK_BASE_URL` | iLink gateway, default `https://ilinkai.weixin.qq.com` |
| `WIXIN_CDN_BASE_URL` | WeChat CDN root, default `https://novac2c.cdn.weixin.qq.com/c2c` |

State files go to `{GATEHOUSE_PROJECT_DIR}/.gatehouse/channels/weixin/` (credentials, cursors, message dedup; legacy `.gatehouse/weixin-bridge/` is auto-detected). Lead session is authoritative from `.gatehouse/registry.db`.

See [IM Channels guide](../../docs/guide/channels.md) for the unified CLI and shared routing logic.

## First Login

```bash
bun run --cwd packages/weixin-bridge login
```

The terminal prints a QR code link — scan with WeChat to confirm. Credentials save to `.gatehouse/weixin-bridge/credentials.json`.

## Run the Bridge

```bash
bun run --cwd packages/weixin-bridge dev
```

WeChat DM → forwarded to the bound registry agent session → reply pushed back to WeChat. The bridge also subscribes to OpenCode events: new assistant messages on the bound session (TUI input, `gatehouse_send_message` from other agents) are auto-pushed to WeChat.

### Switch Agent (`/agent`)

| Command | Behavior |
|---------|----------|
| `/agent` | List switchable agents (`agent_id` + display name) |
| `/agent <agent_id>` | Bind this WeChat user to the agent (exact registry `agent_id` match) |

- **outer:** All `status=active` outer agents are switchable (e.g. `outer:lead`, `outer:arbiter`).
- **inner / retro:** Only agents in the **current mission** (`missions.yaml` running or retro entry, same as Portal) appear; historical inner agents from other missions are not listed or switchable.
- Default binding: `outer:lead` (must be registered in registry with an OpenCode session).

## Architecture

```
WeChat user → iLink → weixin-bridge → OpenCode session (by agent_id) → iLink → WeChat user
```

The bridge **does not** create sessions. It reads registered `agent_id` → `session_id` from the registry. Complete Gatehouse registration in OpenCode first.

`sessions.json` tracks per-user `lastMessageId` (dedup), `activeAgentId`, `lastContextToken` (outbound replies), and `lastDeliveredAssistantBySession` (assistant delivery watermark). Messages are processed in `message_id` order. `context_token` is echoed with each reply to iLink.

## Limitations (MVP)

- **Text + images + voice** (CDN AES decrypt before sending to OpenCode); files/video not yet supported
- Agents can use **`gatehouse_channels_send_file`** to send project images back to WeChat
- DMs only (iLink user messages)
- Long replies auto-split at ~2000 chars
- Requires a running OpenCode instance; bridge does not embed OpenCode

## References

- [OpenClaw WeChat channel](https://docs.openclaw.ai/channels/wechat)
- [@tencent-weixin/openclaw-weixin](https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin) (iLink protocol reference)
- This repo `packages/slack` (OpenCode bridge reference)
