<p align="center">
  <a href="getting-started.md">English</a> |
  <a href="getting-started.zh.md">简体中文</a>
</p>

# Getting Started

Gatehouse is a multi-agent team plugin for [OpenCode](https://opencode.ai). After installation, your terminal conversations are no longer with a single AI — you work with a team that has roles, workflows, and retrospectives.

## Prerequisites

- [OpenCode](https://opencode.ai) >= 1.14.40
- A project directory where you want the team to help (Git repo or plain folder)

## Install the Plugin

```bash
bunx @gatehouse/core install
```

Or use the native OpenCode command (registers the plugin only; does not write global `config.yaml`):

```bash
opencode plug @gatehouse/core --global
```

Verify:

```bash
bunx @gatehouse/core doctor
bunx @gatehouse/core doctor --probe
```

For detailed steps, see the [Installation Guide](./guide/installation.md).

## First Launch

1. `cd` into your project directory.
2. Run `opencode` to start the TUI (only the terminal TUI is verified so far; Desktop / IDE extensions are not yet tested).
3. The plugin automatically:
   - Creates the `.gatehouse/` directory (existing files are not overwritten)
   - Syncs agent definitions to OpenCode
   - Sets the default conversation agent to **Lead**

On a new conversation, Lead assembles the core team (Architect, Curator, Arbiter). You mainly talk to Lead about goals and acceptance criteria.

## Typical Workflow

```text
Discuss direction with Lead
    ↓
Confirm Mission (queued in missions)
    ↓
Lead starts Mission → Architect orchestrates execution tree → inner agents execute
    ↓
Review → retrospective → skill distillation
    ↓
Publish outputs to Portal blog; browse distilled Skills in the Skill tab (optional)
```

You do not need to call low-level tools manually; Lead and the team orchestrate everything in conversation. For tool responsibilities, see [packages/core/README.md](../packages/core/README.md).

## Portal Office

After the plugin starts, the Portal is available in your browser by default:

```text
http://127.0.0.1:18471/
```

The Portal has four tabs:

| Tab | Description |
|-----|-------------|
| **Office** | Pixel-art scene reflecting each agent's status (busy, researching, chatting, idle wandering) |
| **Blog** | Mission retrospective reports and other Markdown content (visible after agents publish) |
| **Skill** | Team skill catalog — browse and search domain skills distilled from retrospectives |
| **Team Data** | Per-Mission token, cost, duration, and role distribution |

Disable the Portal: `GATEHOUSE_PORTAL=0 opencode` (or set the env var in your launch script).

## Configuration

### Locale

In `.gatehouse/config.yaml` (or global `~/.config/gatehouse/config.yaml`):

```yaml
locale: en   # zh | en, default zh
```

- **Agent system prompts**, **meta-skill / skill templates**, and **runtime Gatehouse system messages** switch with `locale`.
- **Tool descriptions** are always in English (not affected by locale).
- Project customizations live under `.gatehouse/zh/` and `.gatehouse/en/` per locale; switching locale **does not** overwrite files you have edited — missing files are filled from bundled templates.
- After changing `locale`, **restart Gatehouse / OpenCode**, or re-run `gatehouse_init_team` on Lead, so injected session system prompts update.

### Role Display Names

Edit `.gatehouse/config.yaml`:

```yaml
agents:
  lead:
    name: Len        # Lead's name in the terminal
  architect:
    name: Archie
  curator:
    name: Kurt
  arbiter:
    name: Art
```

### Models

Assign models per role in the same file (project overrides global):

```yaml
models:
  lead: opencode/big-pickle
  architect: opencode/big-pickle
  curator: opencode/deepseek-v4-flash-free
  arbiter: opencode/deepseek-v4-flash-free
```

Run `opencode models` to list supported models; format is `provider/model-id`.

Global defaults live in `~/.config/gatehouse/config.yaml`.

### Portal Branding and Admin

```yaml
portal:
  brand:
    title: Gatehouse
    subtitle: Team Portal
    logo: brand/logo.png
  # admin_key is auto-generated on first start; unlocks channel admin at http://127.0.0.1:18472/admin
```

The admin key is in `.gatehouse/config.yaml` under `portal.admin_key`. Override with `GATEHOUSE_PORTAL_ADMIN_KEY` (useful for CI or temporary debugging).

## IM Channels (Optional)

To chat with Lead via WeChat, Feishu, or QQ, configure Channels separately:

```bash
bunx @gatehouse/core channels init
bunx @gatehouse/core channels login weixin   # or feishu / qq
bunx @gatehouse/core channels serve
```

See bridge docs:

- [channels-core](../packages/channels-core/README.md)
- [WeChat](../packages/weixin-bridge/README.md)
- [Feishu](../packages/feishu-bridge/README.md)
- [QQ](../packages/qq-bridge/README.md)

## Next Steps

- [Plugin tool reference](../packages/core/README.md) — 14 registry tools and Mission details
- [Portal development](../packages/portal/README.md) — UI debugging and layout
- [Developer guide](./dev.md) — contribute to this repository
