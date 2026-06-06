# @gatehouse/channels-core

Shared logic for Gatehouse IM channel bridges: registry agent routing, `/agent` commands, OpenCode session calls, user state persistence, and **outbound attachment queue**.

Platform bridge source lives in `packages/*-bridge`; `@gatehouse/core` `build` bundles them into `bridges/` for distribution. Platform packages implement protocol only (auth, inbound/outbound messages); core Gatehouse integration lives in this package.

## OpenCode Plugin (Option C)

Standalone plugin entry `@gatehouse/channels-core/plugin` — **not** bundled into `@gatehouse/core`.

On bridge start, the plugin is written to the project root `opencode.jsonc` (same as `@gatehouse/core`; never writes to `.opencode/`):

```json
{
  "plugin": [
    ["@gatehouse/core", {}],
    ["@gatehouse/channels-core", {}]
  ]
}
```

For monorepo dev, set `GATEHOUSE_DEV=1` or `CHANNELS_LOCAL_PLUGIN=1` to use `file://` pointing at local source.

### Tool: `gatehouse_channels_send_file`

Agents call this within an IM conversation turn to queue a **project-directory** local file for outbound delivery; the bridge reads the queue after `promptSession` completes and sends to IM.

```json
{ "path": "output/chart.png" }
```

Queue file: `.gatehouse/channels/outbound/{sessionId}.json`

### Session Outbound Relay (WeChat, etc.)

Bridges subscribe to OpenCode `/event` and push new assistant messages back to IM when the bound session goes `idle` (includes TUI manual input and `gatehouse_send_message` from other agents). `sessions.json` uses `lastDeliveredAssistantBySession` for dedup and `lastContextToken` for the latest inbound iLink context.

## State Directory

```
.gatehouse/channels/{channelId}/
  sessions.json
  sync-buf.json
  credentials.json

.gatehouse/channels/supervisor/
  state.json             # supervisor runtime state (pid / child processes)

.gatehouse/channels.yaml # unified channel config (enabled + platform credentials)

.gatehouse/channels/outbound/
  {sessionId}.json     # pending attachments (written by plugin, consumed by bridge)

.gatehouse/channels/attachments/
  ...                  # downloaded inbound images
```

## Channels Supervisor CLI

Driven by `@gatehouse/core` `channels` subcommands (implementation in this package `src/supervisor/`). Invoke via `bunx @gatehouse/core channels …` (or `gatehouse channels …` after `bun install -g @gatehouse/core`):

```bash
bunx @gatehouse/core channels init [-C project]
bunx @gatehouse/core channels login <weixin|feishu|qq>
bunx @gatehouse/core channels serve [-C project] [weixin feishu qq ...]
bunx @gatehouse/core channels status [--probe]
bunx @gatehouse/core channels stop
bunx @gatehouse/core channels doctor [--probe]
bunx @gatehouse/core channels list
```

The supervisor spawns platform bridge child processes with `[weixin]` / `[feishu]` / `[qq]` log prefixes; abnormal exits auto-restart (rate-limited to prevent loops).

## Usage (Inside Platform Packages)

```ts
import {
  deliverOutboundAttachments,
  ensureChannelsPluginInOpencodeConfig,
  promptSession,
  verifyOpencode,
} from "@gatehouse/channels-core"
```

## Development

```bash
bun run --cwd packages/channels-core typecheck
bun run --cwd packages/channels-core test
```

**Note:** After the first `opencode.jsonc` write, **restart OpenCode** to load `gatehouse_channels_send_file`.
