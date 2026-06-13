<p align="center">
  <a href="installation.md">English</a> |
  <a href="installation.zh.md">简体中文</a>
</p>

# Installation

Gatehouse is a multi-agent team plugin for [OpenCode](https://opencode.ai). Register it globally once, then initialize your project.

| Goal | Command | What it writes |
| :--- | :--- | :--- |
| Standard install | `bunx @gatehouse/core install` | Global `opencode.jsonc` + `tui.json`, agent definitions, `~/.config/gatehouse/config.yaml` |
| Non-interactive install | `bunx @gatehouse/core install --no-tui ...` | Same as above; suitable for CI / LLM agents |
| Project setup | `bunx @gatehouse/core scaffold -C <project>` | `.gatehouse/`, project `opencode.jsonc` |
| Health check | `bunx @gatehouse/core doctor [--probe]` | Checks OpenCode, plugin registration, project layout, Portal |

## CLI Invocation

Recommended — run via Bun without a global install:

```bash
bunx @gatehouse/core <subcommand>
```

All CLI examples below use this form. If you ran `bun install -g @gatehouse/core`, you may shorten `bunx @gatehouse/core` to `gatehouse`.

**Do not** use `npm install -g @gatehouse/core` — Gatehouse is an OpenCode plugin; register via `bunx`. npm cannot run the TypeScript bin directly.

**Recommended path:** Always use `bunx @gatehouse/core install`. `opencode plug @gatehouse/core --global` registers the plugin only — it does not write `config.yaml` or sync agent definitions. Use it only if you know what you are doing.

---

## For Human Users

### Recommended: Let an LLM Agent Install It

Paste this prompt into Cursor, Claude Code, or similar:

```
Install and configure Gatehouse following this document:
https://raw.githubusercontent.com/doee-hc/gatehouse/main/docs/guide/installation.md
```

### Do It Yourself (3 steps)

**1. Global install**

```bash
bunx @gatehouse/core install
```

The wizard asks for UI locale (`zh` / `en`). Prerequisites (OpenCode version + Bun) are enforced. Models are not configured during install — edit `~/.config/gatehouse/config.yaml` if needed.

**2. Verify global layer**

```bash
bunx @gatehouse/core doctor --global-only
```

**3. Project setup (pick one)**

```bash
# A. Create .gatehouse/ now (recommended)
bunx @gatehouse/core scaffold -C /path/to/your/project

# B. Auto-create on first OpenCode start
cd /path/to/your/project && opencode
```

Full verification:

```bash
bunx @gatehouse/core doctor -C /path/to/your/project --probe
```

Open `http://127.0.0.1:18471/` in a browser to view the Portal office.

---

## For LLM Agents

> **IMPORTANT:** Fetch this document with `curl`, not WebFetch — WebFetch drops flag details like `--no-tui` and `--locale`.
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/doee-hc/gatehouse/main/docs/guide/installation.md
> ```

Execute the steps below in order. Greet the user and explain you are helping install Gatehouse.

### Step 0: Verify Prerequisites

`install` enforces these automatically; you can also check manually:

```bash
command -v bun && bun --version
if command -v opencode &> /dev/null; then
  echo "OpenCode $(opencode --version) installed"
else
  echo "OpenCode not installed — install from https://opencode.ai first"
fi
```

Required:

- **Bun** installed (`install` hard dependency)
- **OpenCode >= 1.14.40 and < 1.18.0** (matches `@gatehouse/core` `engines.opencode`)

### Step 1: Collect Install Options

Confirm with the user:

1. **Locale** — `zh` or `en` (default inferred from system `LANG`)
2. **Project directory** — for scaffold / doctor (defaults to cwd)

Do not configure models during install. If the user wants custom models, edit `models` in `~/.config/gatehouse/config.yaml` after install.

### Step 2: Run the Installer

```bash
bunx @gatehouse/core install \
  --no-tui \
  --locale=<zh|en> \
  [--skip-doctor] \
  [-C /path/to/project]
```

**Example:**

```bash
bunx @gatehouse/core install --no-tui --locale=en
```

**The installer writes:**

| Step | Target |
|------|--------|
| Global OpenCode | `~/.config/opencode/opencode.jsonc` → `["@gatehouse/core", {}]` |
| Global TUI | `~/.config/opencode/tui.json` → `["@gatehouse/core", {}]` |
| Agent definitions | `~/.config/opencode/agent/{lead,architect,curator,arbiter,build-root,build-coordinator,build,build-root-solo}.md` |
| Gatehouse config | `~/.config/gatehouse/config.yaml` (locale, if specified) |

### Step 3: Run Doctor (global layer)

```bash
bunx @gatehouse/core doctor --global-only
```

Install runs global-layer doctor automatically. Full doctor categories:

| Category | Checks |
|----------|--------|
| **System** | OpenCode CLI version, Bun |
| **Config** | Global server/TUI plugins, `~/.config/gatehouse/config.yaml` |
| **Agents** | Outer + inner agent `.md` files synced |
| **Project** | `.gatehouse/`, project `opencode.jsonc` (skipped with `--global-only`) |
| **Portal** | Portal ports when `--probe` |
| **Models** | `config.yaml` model format |

Exit codes: `0` = all pass, `1` = errors, `2` = warnings only.

### Step 4: Project Setup

**Option A (recommended):**

```bash
bunx @gatehouse/core scaffold -C /path/to/project
```

**Option B:**

```bash
cd /path/to/project && opencode
```

The plugin creates `.gatehouse/`, writes project `opencode.jsonc`, and starts Portal.

Run doctor again:

```bash
bunx @gatehouse/core doctor -C /path/to/project --probe
```

### Step 5: Provider Authentication (if needed)

If the user configured models in `config.yaml`, ensure OpenCode is logged in:

```bash
opencode auth login
```

### Step 6: IM Channels (optional)

```bash
bunx @gatehouse/core channels init
bunx @gatehouse/core channels doctor --probe
bunx @gatehouse/core channels serve
```

See [docs/guide/channels.md](./channels.md).

---

## Upgrade & Uninstall

```bash
bunx @gatehouse/core upgrade
bunx @gatehouse/core uninstall
bunx @gatehouse/core uninstall --keep-config --keep-agents
```

---

## Local .tgz Install (Advanced)

```bash
bunx @gatehouse/core install ./gatehouse-core-0.1.0.tgz --no-tui --locale=en
```

**Do not** use `opencode plug file:...tgz` — it may hang with no npm download progress.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Install reports missing OpenCode / Bun | Install prerequisites and retry |
| Doctor reports missing `@gatehouse/core` | `bunx @gatehouse/core install` or `upgrade` |
| `.gatehouse/` missing | `scaffold -C <project>` or start `opencode` |
| Portal won't open | Confirm plugin loaded; `doctor --probe` |
| Invalid model | Check `config.yaml` uses `provider/model-id` format |
| Incompatible OpenCode version | Upgrade to >= 1.14.40 and < 1.18.0 |

---

## CLI Reference

| Command | Description |
|---------|-------------|
| `bunx @gatehouse/core install` | Interactive global install |
| `bunx @gatehouse/core install --no-tui --locale=en` | Non-interactive install |
| `bunx @gatehouse/core scaffold -C <project>` | Initialize project layer early |
| `bunx @gatehouse/core upgrade` | Refresh plugin + agent definitions |
| `bunx @gatehouse/core uninstall` | Remove global plugin |
| `bunx @gatehouse/core doctor [--global-only] [--probe]` | Health check |
| `bunx @gatehouse/core channels init\|login\|serve\|...` | IM channel management |
| `bunx @gatehouse/core portal` | Print Portal URL hint |

---

## Configuration Layers

| File | Purpose |
|------|---------|
| `~/.config/gatehouse/config.yaml` | Global: locale, models, Portal branding |
| `.gatehouse/config.yaml` | Project-level overrides |
| `~/.config/opencode/opencode.jsonc` | Global OpenCode plugins |
| `~/.config/opencode/tui.json` | Gatehouse TUI plugin |
| `{project}/opencode.jsonc` | Project `default_agent`, `skills.paths` |

The installer initializes the **global** layer only; the project layer is created via `scaffold` or first `opencode` start.
