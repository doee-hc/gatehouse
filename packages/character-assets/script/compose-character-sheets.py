#!/usr/bin/env python3
"""
Compose Gatehouse portal character sheets from LimeZu Character Generator pieces.

Reads layered PNGs (1792×1280, 56×20 grid of 32×64 cells), extracts idle / run / sit
frames, and writes 384×384 portal atlases (12×6 grid) plus optional JSON regen.

Source frame indices match LimeZu Modern Interiors layout (32×32 cell size).
See: https://geowarin.com/setup-modern-interiors-characters-in-godot/
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from PIL import Image

HORIZ = 56
CELL_W = 32
CELL_H = 64
OUT_W = 384
OUT_H = 384
GRID_COLS = 12
GRID_ROWS = 6

# Portal packs two direction groups per row: (down, left) then (right, up).
PORTAL_ANIMS = ("idle", "run", "sit")
PORTAL_DIRS = ("down", "left", "right", "up")

# LimeZu / Character Generator 2.0 source indices (first frame of each 6-frame group).
# 1792×1280 sheets use 56 columns × 20 rows of 32×64 cells.
#
# idle + run follow the usual row pattern (groups of 6: right, up, left, down).
# run row uses column offset 0 (not 2); geowarin's 114/120/… skips two empty cells.
# idle_down index 80 (6th frame) is blank in every Body sheet — duplicated from frame 4.
#
# sit is split across rows in CG 2.0 — row 7 is read/book, not chair sit.
# Calibrated against portal reference sheets:
#   side sit  → row 4  (right col 0, left col 6)
#   front/back sit → row 11 (up col 19, down col 47)
SOURCE_GROUPS: dict[str, dict[str, int]] = {
    "idle": {"right": 57, "up": 63, "left": 69, "down": 75},
    "run": {"right": 112, "up": 118, "left": 124, "down": 130},
    "sit": {"right": 224, "up": 635, "left": 230, "down": 663},
}

LAYER_ORDER = ("body", "eyes", "hairstyle", "outfit", "accessory")
LAYER_DIRS = {
    "body": "Bodies",
    "eyes": "Eyes",
    "hairstyle": "Hairstyles",
    "outfit": "Outfits",
    "accessory": "Accessories",
}


def pkg_root() -> Path:
    return Path(__file__).resolve().parent.parent


def default_generator_root() -> Path:
    env = os.environ.get("CHARACTER_GENERATOR_ROOT")
    if env:
        return Path(env).resolve()
    # gatehouse-workspace/Character_Generator (sibling to gatehouse repo)
    return (pkg_root().parent.parent / "Character_Generator").resolve()


def resolve_piece(generator_root: Path, size: str, layer: str, filename: str) -> Path:
    folder = LAYER_DIRS[layer]
    path = generator_root / "Character Pieces" / folder / size / filename
    if not path.is_file():
        raise FileNotFoundError(f"Missing character piece: {path}")
    return path


def compose_layers(paths: list[Path]) -> Image.Image:
    canvas = Image.new("RGBA", (1792, 1280), (0, 0, 0, 0))
    for path in paths:
        layer = Image.open(path).convert("RGBA")
        canvas = Image.alpha_composite(canvas, layer)
    return canvas


def source_cell(sheet: Image.Image, index: int) -> Image.Image:
    col = index % HORIZ
    row = index // HORIZ
    x = col * CELL_W
    y = row * CELL_H
    return sheet.crop((x, y, x + CELL_W, y + CELL_H))


def cell_has_content(cell: Image.Image) -> bool:
    alpha = cell.getchannel("A")
    return alpha.getextrema()[1] > 0


def source_cell_for_frame(sheet: Image.Image, base: int, frame: int) -> Image.Image:
    """Return source cell for one portal frame; fill gaps in sparse LimeZu groups."""
    cell = source_cell(sheet, base + frame)
    if cell_has_content(cell):
        return cell
    for prev in range(frame - 1, -1, -1):
        fallback = source_cell(sheet, base + prev)
        if cell_has_content(fallback):
            return fallback
    return source_cell(sheet, base)


def pack_portal_sheet(source: Image.Image) -> Image.Image:
    out = Image.new("RGBA", (OUT_W, OUT_H), (0, 0, 0, 0))
    for anim_i, anim in enumerate(PORTAL_ANIMS):
        for pair_i, pair in enumerate((("down", "left"), ("right", "up"))):
            out_row = anim_i * 2 + pair_i
            for group_i, direction in enumerate(pair):
                base = SOURCE_GROUPS[anim][direction]
                for frame in range(6):
                    cell = source_cell_for_frame(source, base, frame)
                    out_col = group_i * 6 + frame
                    out.paste(cell, (out_col * CELL_W, out_row * CELL_H), cell)
    return out


def frame_keys(role: str) -> list[str]:
    keys: list[str] = []
    for anim in PORTAL_ANIMS:
        for direction in PORTAL_DIRS:
            for i in range(6):
                keys.append(f"{role}_{anim}_{direction}_{i}")
    return keys


def write_atlas_json(role: str, out_dir: Path) -> None:
    keys = frame_keys(role)
    frames: dict[str, object] = {}
    for i, key in enumerate(keys):
        col = i % GRID_COLS
        row = i // GRID_COLS
        x = col * CELL_W
        y = row * CELL_H
        frames[key] = {
            "frame": {"x": x, "y": y, "w": CELL_W, "h": CELL_H},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": CELL_W, "h": CELL_H},
            "sourceSize": {"w": CELL_W, "h": CELL_H},
        }

    payload = {
        "frames": frames,
        "meta": {
            "app": "@gatehouse/portal/compose-character-sheets",
            "version": "1.0",
            "image": f"{role}-1x1.png",
            "format": "RGBA8888",
            "size": {"w": OUT_W, "h": OUT_H},
            "scale": "1",
        },
    }
    out_dir.joinpath(f"{role}-1x1.json").write_text(
        json.dumps(payload, indent=2) + "\n",
        encoding="utf-8",
    )


def load_recipes(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if "roles" not in data or not isinstance(data["roles"], dict):
        raise ValueError(f"Invalid recipes file (missing roles): {path}")
    return data


def compose_role(
    *,
    role: str,
    recipe: dict,
    generator_root: Path,
    size: str,
    out_dir: Path,
    write_json: bool,
) -> Path:
    layer_paths: list[Path] = []
    for layer in LAYER_ORDER:
        filename = recipe.get(layer)
        if not filename:
            continue
        layer_paths.append(resolve_piece(generator_root, size, layer, filename))

    if not layer_paths:
        raise ValueError(f"Role {role}: recipe must include at least one layer")

    source = compose_layers(layer_paths)
    portal = pack_portal_sheet(source)
    png_path = out_dir / f"{role}-1x1.png"
    portal.save(png_path)
    if write_json:
        write_atlas_json(role, out_dir)
    return png_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--recipes",
        type=Path,
        default=pkg_root() / "script" / "outer-recipes.json",
        help="JSON file with per-role layer filenames",
    )
    parser.add_argument(
        "--generator-root",
        type=Path,
        default=None,
        help="Character_Generator directory (default: ../Character_Generator or $CHARACTER_GENERATOR_ROOT)",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=pkg_root() / "public" / "assets" / "characters" / "sheets",
        help="Output directory for {role}-1x1.png",
    )
    parser.add_argument(
        "--roles",
        nargs="*",
        help="Subset of roles to generate (default: all in recipes)",
    )
    parser.add_argument(
        "--size",
        default=None,
        help="Piece size folder (default: value from recipes or 32x32)",
    )
    parser.add_argument(
        "--no-json",
        action="store_true",
        help="Skip writing Phaser atlas JSON (PNG only)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    recipes_path = args.recipes.resolve()
    config = load_recipes(recipes_path)

    if args.generator_root:
        generator_root = args.generator_root
    elif config.get("characterGeneratorRoot"):
        raw = Path(config["characterGeneratorRoot"])
        generator_root = raw if raw.is_absolute() else (recipes_path.parent / raw)
    else:
        generator_root = default_generator_root()
    generator_root = generator_root.resolve()
    if not generator_root.is_dir():
        print(f"Character Generator not found: {generator_root}", file=sys.stderr)
        print("Set CHARACTER_GENERATOR_ROOT or edit characterGeneratorRoot in recipes JSON.", file=sys.stderr)
        return 1

    size = args.size or config.get("size") or "32x32"
    out_dir = args.out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    roles_cfg: dict = config["roles"]
    selected = args.roles or list(roles_cfg.keys())

    for role in selected:
        if role not in roles_cfg:
            print(f"Unknown role: {role}", file=sys.stderr)
            return 1
        png = compose_role(
            role=role,
            recipe=roles_cfg[role],
            generator_root=generator_root,
            size=size,
            out_dir=out_dir,
            write_json=not args.no_json,
        )
        print(f"Wrote {png}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
