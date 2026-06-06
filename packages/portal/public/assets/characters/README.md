# Character sheets

Each role has exactly two files under `sheets/`:

| File | Size | Purpose |
|------|------|---------|
| `{role}-1x1.png` | 384×384 | Sprite sheet — **edit this** |
| `{role}-1x1.json` | — | Phaser frame map (12×6 grid, 32×64 cells) |

## Shipped roles

Configured in `manifest.json`:

| Type | Count | Names |
|------|-------|-------|
| Outer (fixed) | 4 | `lead`, `architect`, `curator`, `arbiter` |
| Inner pool | 32 | `pool-01` … `pool-32` |

At runtime: outer maps to `spawn_id`; inner / retro nodes pick pool appearance stably via `hash(spawn_id | node_id) % 32`.

## Frame keys

`{prefix}_{idle|run|sit}_{down|left|right|up}_{0-5}` — left→right, top→bottom.

Runtime: `src/office/character-anims.ts`, `src/office/character-sheets.ts`

## Update one role

Replace `sheets/{role}-1x1.png` only (keep 384×384 grid). JSON unchanged if layout is preserved.

## Regenerate JSON

```bash
cd packages/portal && bun run build:character-sheet-json
```

## Generate new sheets (local only)

LimeZu Character Generator source assets **do not ship with the repo**. Synthesize locally with `packages/character-assets`, then sync:

```bash
cd packages/character-assets
CHARACTER_POOL_SEED=56 bun run generate:all
```

See [`packages/character-assets/README.md`](../../../character-assets/README.md).
