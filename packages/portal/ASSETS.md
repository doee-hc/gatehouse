# Gatehouse Portal — Asset Sources and Licensing

The office UI uses sliced PNGs from **purchased LimeZu packs**, assembled into dynamic scenes by repo scripts.

## Production Assets

| Category | Source | Repo path | Runtime load |
|----------|--------|-----------|--------------|
| **Office background + desk furniture** | LimeZu Modern Office / Interiors | `packages/core/assets/office-layout-gen/manual_assets/` | Portal API `/portal/api/office/scene-bg.png`, `/assets/objects/*.png` |
| **Office collision / map** | Layout script output | Project `.gatehouse/portal/office/` (written by `import:office-layout`) | `/portal/api/office/map.json`, `collision-tile.png` |
| **Character sprites** | One 1:1 sprite sheet per character | `public/assets/characters/sheets/{role}-1x1.{png,json}` | `OfficeScene` preload (4 outer + 32 pool) |

Frame naming: `{prefix}_{idle|run|sit}_{down|left|right|up}_{n}` — see [`public/assets/characters/README.md`](public/assets/characters/README.md) and `src/office/character-anims.ts`.

## LimeZu License

| Pack | Link | Requirements |
|------|------|--------------|
| Modern Office | https://limezu.itch.io/modernoffice | Commercial use OK; **attribution required**; **do not redistribute** original zip |
| Modern Interiors | https://limezu.itch.io/moderninteriors | Same as above |

The Portal **About** tab credits LimeZu (see `index.html` → `#view-about`). Shipped products must keep this attribution visible.

## Updating Assets

Place purchased packs under **repo root `pixel_materials/`** (not in git):

```
pixel_materials/
  office-layout-gen/manual_assets/     # optional: override committed slices in core
```

```bash
cd packages/portal

# Office: generate layout dynamically per Mission
GATEHOUSE_PROJECT_DIR=/path/to/project bun run import:office-layout
```

Runtime loads `sheets/{role}-1x1.{png,json}` directly; replace a single character by swapping its PNG (keep 384×384 grid). If JSON is missing, run `bun run build:character-sheet-json`.

Character **source synthesis** lives in local package `packages/character-assets` (gitignored `assets/` output); the repo commits only synthesized 4 outer + 32 pool. See [`packages/character-assets/README.md`](../character-assets/README.md).

`import:office-layout` prefers `packages/core/assets/office-layout-gen/manual_assets/`; falls back to `pixel_materials/office-layout-gen/manual_assets/` only when that directory is missing.

## Related Docs

- [README.md](./README.md) — Portal local run
- [public/assets/characters/README.md](public/assets/characters/README.md) — character atlas frame names
