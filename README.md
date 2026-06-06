
<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a>
</p>

# Gatehouse

**A self-improving multi-agent team**

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://github.com/doee-hc/gatehouse/actions/workflows/ci.yml"><img src="https://github.com/doee-hc/gatehouse/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://opencode.ai"><img src="https://img.shields.io/badge/OpenCode-Plugin-6366f1.svg" alt="OpenCode Plugin"></a>
  <a href="https://github.com/doee-hc/gatehouse"><img src="https://img.shields.io/github/stars/doee-hc/gatehouse?style=social" alt="GitHub stars"></a>
</p>

Built on [OpenCode](https://opencode.ai) — role-based collaboration, Mission lifecycle, and a visual Portal office.

> [!WARNING]
> **Early Development Notice:** Gatehouse is in early development and is not yet ready for production use. Features may change, break, or be incomplete. Use at your own risk.

<p align="center">
  <img src="./docs/assets/portal-preview-en.gif" alt="Gatehouse Portal office preview" width="800">
</p>

Run the plugin locally and visit `http://127.0.0.1:18471/` to explore the office UI. A standalone Portal site is planned as the public project hub.

---

### Installation

**Prerequisites:** [OpenCode](https://opencode.ai) >= 1.14.40 installed.

```bash
# Register the Gatehouse plugin (global, one-time)
opencode plug @gatehouse/core --global

# Or use the install helper (recommended: configurable locale / models)
bunx @gatehouse/core install

# Verify installation
bunx @gatehouse/core doctor
```

Full installation guide (including step-by-step LLM Agent instructions): [docs/guide/installation.md](./docs/guide/installation.md)

Then start OpenCode in **your project directory**. The plugin automatically initializes `.gatehouse/` config and agent definitions, and sets the default conversation agent to **Lead** (display name is configurable).

### Quick Start

1. **Launch** — Run `opencode` from the project root to start the TUI (Desktop / IDE extensions are not yet verified).
2. **Talk to Lead** — Describe your goals and constraints; Lead assembles the core team (Architect, Curator, Arbiter, and other roles).
3. **Confirm Mission** — Once aligned, Lead enqueues the task and starts a Mission; the inner execution team is orchestrated by the plugin.
4. **Open Portal** — Visit `http://127.0.0.1:18471/` in your browser to watch agent status and collaboration in the office view; Mission outputs can be published to the Portal blog, and distilled Skills are browsable in the Skill tab.

For the full user workflow, see the [Getting Started guide](./docs/getting-started.md).

### What You Get

- **Core team** — Lead, Architect, Curator, and Arbiter with clear responsibilities; role display names and models are customizable in config.
- **Mission lifecycle** — Queue → execute → review → retrospective → skill distillation; team state persists in the project's `.gatehouse/`.
- **Self-improvement** — Retrospectives and skill extraction feed back into future Missions as the team evolves with your project.
- **Portal office** — Phaser pixel-art office: agents at their desks when busy, wandering when idle; includes a blog and Skill tab.
- **IM channels (optional)** — Chat remotely with any team member via WeChat / Feishu / QQ (see [Channels docs](./packages/channels-core/README.md)).

### Configuration

Gatehouse uses two configuration layers; project-level overrides global:

| File | Purpose |
| --- | --- |
| `~/.config/gatehouse/config.yaml` | Global: role display names, default models, Portal branding |
| `.gatehouse/config.yaml` | Project-level overrides |

Project config is auto-generated on first OpenCode launch. Details: [Getting Started — Configuration](./docs/getting-started.md#configuration).

### Documentation

| Doc | Description |
| --- | --- |
| [docs/getting-started.md](./docs/getting-started.md) | Quick start, Mission workflow, Portal |
| [docs/guide/installation.md](./docs/guide/installation.md) | Full installation guide |
| [packages/core/README.md](./packages/core/README.md) | Plugin tool reference (advanced) |
| [packages/portal/README.md](./packages/portal/README.md) | Portal development and debugging |
| [docs/dev.md](./docs/dev.md) | Monorepo development and contributing |
| [CHANGELOG.md](./CHANGELOG.md) | Release history and known limitations |
| [docs/README.md](./docs/README.md) | Documentation index |

A standalone docs site and public Portal hub are planned; links will be added here once deployed.

### Development & Contributing

This repository is the Gatehouse monorepo. Local development, testing, and release workflow: [docs/dev.md](./docs/dev.md).

### Building on OpenCode

Gatehouse is a community plugin built on [OpenCode](https://opencode.ai). It is **not** developed or maintained by the OpenCode team and is not affiliated with OpenCode in any way. Using OpenCode means you agree to its respective terms of use and privacy policy.

Portal office pixel art is from [LimeZu](https://limezu.itch.io/) — thanks to the author for the wonderful work.

---

## Star History

<a href="https://star-history.com/#doee-hc/gatehouse&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=doee-hc/gatehouse&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=doee-hc/gatehouse&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=doee-hc/gatehouse&type=Date" />
  </picture>
</a>
