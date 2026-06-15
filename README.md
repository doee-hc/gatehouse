
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

### Architecture

Gatehouse is built on one premise: **teams are ephemeral; domain knowledge is persistent.**

Each Mission spins up an execution team on demand and releases it when done. What persists across Missions is the skill library, retrospective reports, and architectural learnings—not a fixed roster of agents. The team evolves with your project instead of relying on a permanent org chart.

#### Design principles

| Principle | Description |
| --- | --- |
| **Persistent knowledge, ephemeral teams** | Execution teams are created and dissolved per Mission; `.gatehouse/` accumulates domain skills, retros, and architectural experience |
| **Stable outer ring, flexible inner ring** | The core quartet (Lead / Architect / Curator / Arbiter) persists; inner topology is tailored per Mission by Architect |
| **Closed-loop self-improvement** | Plan → assemble → execute → accept → retro → skill distillation feeds the next Mission |

#### Core roles

**Lead** — Aligns with your long-term direction and owns the mission queue and acceptance criteria. Plans the roadmap from history and retros; agrees on objectives, constraints, and done-when with you; accepts delivery against `done_when` and decides whether to retro or close out.

**Architect** — A persistent, independent agent that answers "what team does this Mission need?" Designs TeamSpec (how many agents, how many coordination layers) from the frozen mission snapshot; the team dissolves when the Mission ends and is redesigned next time. During retro, reviews full team context and evaluates collaboration efficiency—token usage, tool calls, inter-agent messaging, elapsed time, and other metrics Architect explores in practice—and distills "what structure fits what kind of work" into meta-skills for better team design over time.

**Curator** — Independent skill librarian. After Architect submits the orchestration script, Curator assigns domain skills to execution nodes; after retro, executors extract skill updates from the work and Curator analyzes, consolidates, and archives them for reuse.

**Arbiter** — Independent permission authority; does not execute Missions. When the team hits risky or sensitive operations, Arbiter centrally decides allow / reject and maintains an audit trail.

#### Execution safeguards

**Watchdog** — Built into the execution tree. When a node is marked `running` in orchestration but its session goes idle (e.g. work finished without `gatehouse_execution_complete`, or root stalled before final delivery), Gatehouse wakes **that session** directly to unblock the stalled step.

**Mission lifecycle** — Queue → assemble → execute → accept → retro → skill distillation → complete. Lead freezes the mission snapshot; Architect writes `mission.script.ts` and submits orchestration; Curator assigns skills and the execution team starts automatically; after acceptance Lead kicks off retro; Architect and Curator summarize architecture and skills respectively, feeding the next planning cycle.

```mermaid
flowchart TB
  User([User]) <--> Lead
  Lead -->|freeze snapshot| Architect
  Architect -->|mission.script.ts / submit| Curator
  Curator -->|assign skills| ExecTeam[Execution team]
  ExecTeam -->|risky ops| Arbiter
  ExecTeam -.->|abnormal idle| Watchdog
  Watchdog -.->|wake| ExecTeam
  ExecTeam -->|deliver| Lead
  Lead -->|accept| Retro[Retro]
  Retro --> Architect
  Retro --> Curator
  Architect -->|architecture| Skills[(Skill library)]
  Curator -->|domain knowledge| Skills
  Skills -.->|feedback| Lead
```

---

### Installation

**Prerequisites:** [OpenCode](https://opencode.ai) >= 1.14.40, [Bun](https://bun.sh).

```bash
# Global install (recommended)
bunx @gatehouse/core install

# Verify global layer
bunx @gatehouse/core doctor --global-only

# Project setup (pick one)
bunx @gatehouse/core scaffold -C /path/to/project   # create .gatehouse/ now
cd /path/to/project && opencode                        # or auto-create on first start
```

Full installation guide (including step-by-step LLM Agent instructions): [docs/guide/installation.md](./docs/guide/installation.md)

Models and other advanced settings are not configured during install — edit `~/.config/gatehouse/config.yaml` or `.gatehouse/config.yaml` when needed.

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
- **IM channels** — Chat remotely with any team member via WeChat / Feishu / QQ ([IM Channels guide](./docs/guide/channels.md)).

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
| [docs/guide/channels.md](./docs/guide/channels.md) | IM channels (WeChat / Feishu / QQ) |
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

<a href="https://www.star-history.com/?repos=doee-hc%2Fgatehouse&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=doee-hc/gatehouse&type=date&theme=dark&legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=doee-hc/gatehouse&type=date&legend=top-left" />
    <img alt="Star History Chart" src="https://api.star-history.com/image?repos=doee-hc/gatehouse&type=date&legend=top-left" />
  </picture>
</a>
