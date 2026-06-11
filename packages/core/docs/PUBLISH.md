# Publishing `@gatehouse/core`

| Package | Contents |
|---------|----------|
| `@gatehouse/core` | OpenCode server + TUI plugins, `.gatehouse` templates, Portal UI (`dist/portal/`), **channels** (`src/channels/`), bundled IM bridges (`bridges/`) |

IM channel logic and the OpenCode plugin entry **`@gatehouse/core/channels/plugin`** ship inside `@gatehouse/core`.

`bun run build` copies `packages/*-bridge/src` into `packages/core/bridges/`. `bunx @gatehouse/core channels serve` resolves bridge entrypoints from the installed `@gatehouse/core` package (via `.gatehouse/core.path`). Separate `@gatehouse/*-bridge` npm packages are **not** required for end users.

Release notes for each version: [CHANGELOG.md](../../../CHANGELOG.md) at the repo root.

## Prerequisites

- Bun >= 1.1
- OpenCode >= 1.14.40
- npm account with access to publish under **`@gatehouse`**

## npm organization `@gatehouse`

The first publish must go to the scoped package `@gatehouse/core`. Create the org **before** running `npm publish`.

### 1. Create the organization (one-time)

1. Sign in at [npmjs.com](https://www.npmjs.com/).
2. Open **Account → Organizations → Create an organization**.
3. Choose the **free/unlimited public packages** plan unless you need private packages.
4. Set the organization name to **`gatehouse`** (npm scope: `@gatehouse`).

Alternatively, from the CLI after `npm login`:

```bash
npm org create gatehouse
```

### 2. Verify access

```bash
npm whoami
npm org ls gatehouse
```

You should see your npm user listed as **owner** or **developer** on the org.

### 3. Verify package is not yet published (expected before first release)

```bash
curl -fsS "https://registry.npmjs.org/@gatehouse%2fcore" || echo "@gatehouse/core not published yet"
```

## Build

From `packages/core`:

```bash
bun run build
```

This runs `packages/portal` Vite build and copies output to `dist/portal/`. Plugin entrypoints stay as TypeScript under `src/`.

## Local verification

From the monorepo root:

```bash
bun run typecheck
bun run test
bun run build
bun run --cwd packages/core pack

# Monorepo dev (file:// plugin in project config)
bun run dev /path/to/project
```

## Publish to npm

1. Bump `packages/core/package.json` version; update [CHANGELOG.md](../../../CHANGELOG.md).
2. Log in: `npm login`
3. Publish **core**:

```bash
cd packages/core
bun run pack
npm publish --access public
```

4. Tag the GitHub release (recommended):

```bash
git tag v0.1.0
git push origin v0.1.0
```

## User setup (recommended)

**One-time** — register the plugin globally:

```bash
opencode plug @gatehouse/core --global
```

Or edit `~/.config/opencode/opencode.jsonc`:

```jsonc
{ "plugin": ["@gatehouse/core"] }
```

And `~/.config/opencode/tui.json`:

```jsonc
{ "plugin": ["@gatehouse/core"] }
```

Optional CLI (registers plugin + can write global config.yaml):

```bash
bunx @gatehouse/core install
bunx @gatehouse/core install --no-tui --locale=zh
bunx @gatehouse/core doctor --global-only
```

Full guide: `docs/guide/installation.md`

**Every project** — `cd` into the repo and start OpenCode. Gatehouse creates `.gatehouse/` and agent files on first load. No `install /path/to/project` step.
