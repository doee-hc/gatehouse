<p align="center">
  <a href="installation.md">English</a> |
  <a href="installation.zh.md">简体中文</a>
</p>

# Installation

Gatehouse is a multi-agent team plugin for [OpenCode](https://opencode.ai). Register it globally once; starting the OpenCode TUI in a project directory auto-creates `.gatehouse/`.

| Goal | Command | What it writes |
| :--- | :--- | :--- |
| Standard install | `bunx @gatehouse/core install` | Global `opencode.jsonc` + `tui.json`, agent definitions, `~/.config/gatehouse/config.yaml` |
| Non-interactive install | `bunx @gatehouse/core install --no-tui ...` | Same as above; suitable for CI / LLM agents |
| Health check | `bunx @gatehouse/core doctor [--probe]` | Checks OpenCode, plugin registration, `.gatehouse/` project layout, Portal |

**Do not** use `npm install -g @gatehouse/core` — Gatehouse is an OpenCode plugin; register via `bunx` or `opencode plug`.

---

## For Human Users

### Recommended: Let an LLM Agent Install It

Installation involves OpenCode version, global plugin registration, and locale / model presets — paste this prompt into Cursor, Claude Code, or similar:

```
Install and configure Gatehouse following this document:
https://raw.githubusercontent.com/doee-hc/gatehouse/main/docs/guide/installation.md
```

### Do It Yourself (Interactive)

```bash
bunx @gatehouse/core install
```

The wizard asks for:

1. UI locale (`zh` / `en`)
2. Default model (optional; format `provider/model-id`, e.g. `opencode/big-pickle`; run `opencode models` to list installed providers)

### Verify

```bash
bunx @gatehouse/core doctor
bunx @gatehouse/core doctor --probe   # also probes Portal port
```

Then start OpenCode in your project:

```bash
cd /path/to/your/project
opencode
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

Check OpenCode:

```bash
if command -v opencode &> /dev/null; then
  echo "OpenCode $(opencode --version) installed"
else
  echo "OpenCode not installed — install from https://opencode.ai first"
fi
```

Required: **OpenCode >= 1.14.40 and < 1.17.0** (matches `@gatehouse/core` `engines.opencode`).

Check Bun (recommended):

```bash
command -v bun && bun --version
```

### Step 1: Collect Install Options

Confirm with the user:

1. **Locale** — `zh` or `en` (default `zh`)
2. **Default model** (optional) — e.g. `opencode/big-pickle`; leave empty for OpenCode default. Run `opencode models` to list available models.
3. **Project directory** — for post-install doctor checks (defaults to cwd)

### Step 2: Run the Installer

Non-interactive example:

```bash
bunx @gatehouse/core install \
  --no-tui \
  --locale=<zh|en> \
  [--model=<provider/model-id>] \
  [--skip-doctor] \
  [-C /path/to/project]
```

**Examples:**

- English + single model:
  ```bash
  bunx @gatehouse/core install --no-tui --locale=en --model=opencode/big-pickle
  ```
- Register plugin only, skip doctor:
  ```bash
  bunx @gatehouse/core install --no-tui --locale=en --skip-doctor
  ```

**Equivalent (native OpenCode):**

```bash
opencode plug @gatehouse/core --global
```

This registers the plugin only and **does not** write `~/.config/gatehouse/config.yaml` — run `gatehouse install` if you need locale / model presets.

**The installer writes:**

| Step | Target |
|------|--------|
| Global OpenCode | `~/.config/opencode/opencode.jsonc` → `["@gatehouse/core", {}]` |
| Global TUI | `~/.config/opencode/tui.json` → `["@gatehouse/core", {}]` (OpenCode resolves `exports["./tui"]`) |
| Agent definitions | `~/.config/opencode/agent/{lead,architect,curator,arbiter}.md` |
| Gatehouse config | `~/.config/gatehouse/config.yaml` (locale / models, if specified) |

### Step 3: Run Doctor

```bash
bunx @gatehouse/core doctor [-C /path/to/project] [--probe]
```

Doctor checks six categories:

| Category | Checks |
|----------|--------|
| **System** | OpenCode CLI version, Bun |
| **Config** | Global server/TUI plugins, `~/.config/gatehouse/config.yaml` |
| **Agents** | Four outer agent `.md` files synced |
| **Project** | `.gatehouse/`, project `opencode.jsonc` `default_agent` / `skills.paths` |
| **Portal** | Probes configured portal ports (default 18471 / 18472) when `--probe` |
| **Models** | `config.yaml` model format |

Exit codes: `0` = all pass, `1` = errors, `2` = warnings only.

### Step 4: First Project Launch

```bash
cd /path/to/project
opencode
```

The plugin automatically:

- Creates `.gatehouse/` (does not overwrite existing files)
- Writes project `opencode.jsonc` (`default_agent: lead`, `skills.paths: [".gatehouse"]`)
- Starts Portal (default `http://127.0.0.1:18471/`)

Run doctor again to confirm Project / Models pass:

```bash
bunx @gatehouse/core doctor --probe
```

### Step 5: Provider Authentication

If the user specified `--model=opencode/...` or another provider, ensure OpenCode is logged in:

```bash
opencode auth login
```

Complete OAuth / API key setup per OpenCode prompts.

### Step 6: (Optional) IM Channels

```bash
gatehouse channels init
gatehouse channels doctor --probe
gatehouse channels serve
```

See [packages/channels-core/README.md](../../packages/channels-core/README.md).

---

## Local .tgz Install (Advanced)

For release tarballs or offline environments:

```bash
# `bun pm pack` in packages/core produces gatehouse-core-<version>.tgz (@gatehouse/core npm pack name)
tar -xzf gatehouse-core-0.1.0.tgz
bun ./package/bin/gatehouse.ts install ./gatehouse-core-0.1.0.tgz --no-tui --locale=en
```

**Do not** use `opencode plug file:...tgz` — it may hang with no npm download progress.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Doctor reports missing `@gatehouse/core` | Re-run `bunx @gatehouse/core install` |
| `.gatehouse/` missing | Start `opencode` once from project root |
| Portal won't open | Confirm OpenCode loaded the plugin; run `doctor --probe` |
| Invalid model | Check `config.yaml` uses `provider/model-id` format |
| Incompatible OpenCode version | Upgrade to >= 1.14.40 and < 1.17.0 |

---

## CLI Reference

| Command | Description |
|---------|-------------|
| `bunx @gatehouse/core install` | Interactive global install |
| `bunx @gatehouse/core install --no-tui --locale=en --model=...` | Non-interactive install |
| `bunx @gatehouse/core doctor [--probe]` | Health check |
| `gatehouse channels doctor [--probe]` | IM channels health check |
| `gatehouse portal` | Print Portal URL hint |
| `opencode plug @gatehouse/core --global` | Native OpenCode registration (no config.yaml) |

---

## Configuration Layers

| File | Purpose |
|------|---------|
| `~/.config/gatehouse/config.yaml` | Global: locale, default models, Portal branding |
| `.gatehouse/config.yaml` | Project-level overrides |
| `~/.config/opencode/opencode.jsonc` | Global OpenCode plugins |
| `~/.config/opencode/tui.json` | Gatehouse TUI plugin |
| `{project}/opencode.jsonc` | Project `default_agent`, `skills.paths` |

The installer initializes the **global** layer only; the project layer is created on first OpenCode start.
