# Character Assets (Local Only)

LimeZu **Character_Generator** source assets have copyright restrictions and **cannot ship with the repo**. This package synthesizes character sprite sheets locally, then syncs finished output into `packages/portal`.

## Requirements

- LimeZu Character Generator installed locally (directory usually named `Character_Generator`)
- Python 3 + Pillow (`pip install pillow`)
- Suggested path: `gatehouse-workspace/Character_Generator` (sibling to the `gatehouse` repo)

Or set via environment variable:

```bash
export CHARACTER_GENERATOR_ROOT=/path/to/Character_Generator
```

## Generate 36 Characters (4 Outer + 32 Pool)

```bash
cd packages/character-assets

# One-shot: synthesize outer + random pool, sync to portal
CHARACTER_POOL_SEED=56 bun run generate:all

# Or step by step
bun run generate:outer          # 4 fixed outer (script/outer-recipes.json)
bun run generate:pool           # 32 pool (--seed for reproducibility)
bun run sync:portal             # copy to portal/public/.../sheets/
```

### Customize Outer Appearance

Edit `script/outer-recipes.json` (4 roles: `lead`, `architect`, `curator`, `arbiter`), then `bun run generate:outer && bun run sync:portal`.

### Customize Pool Random Rules

Edit `script/office-piece-filter.json` (body / hair / accessory filters), then `bun run generate:pool`.

## Migrate from Existing Preview

If you previously generated `preview/random-16/` (`random-01` … `random-32`) in portal:

```bash
bun run migrate:preview
bun run sync:portal
```

## What Gets Published to Portal

`sync:portal` copies only **synthesized** `{role}-1x1.png` + `{role}-1x1.json`:

| Type | Count | Names |
|------|-------|-------|
| Outer (fixed) | 4 | `lead`, `architect`, `curator`, `arbiter` |
| Inner pool | 32 | `pool-01` … `pool-32` |

At runtime: outer maps fixed to `spawn_id`; inner picks stably from 32 pool sheets via `hash(spawn_id)`. Config: `packages/portal/public/assets/characters/manifest.json`.

## Local Directories (Gitignored by Default)

```
packages/character-assets/assets/
  outer/          # synthesis output
  pool/           # synthesis output + recipes.json
```
