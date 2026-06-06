#!/usr/bin/env python3
"""Pick random Character Generator layers and compose inner pool sprite sheets."""
from __future__ import annotations

import argparse
import json
import random
import subprocess
import sys
from pathlib import Path

pkg_root = Path(__file__).resolve().parent.parent
script_dir = Path(__file__).resolve().parent
compose_script = script_dir / "compose-character-sheets.py"
default_filter_path = script_dir / "office-piece-filter.json"

sys.path.insert(0, str(script_dir))
from piece_filter import apply_office_filter, validate_pools  # noqa: E402


def list_pieces(generator_root: Path, layer_dir: str, size: str) -> list[str]:
    folder = generator_root / "Character Pieces" / layer_dir / size
    if not folder.is_dir():
        raise FileNotFoundError(f"Missing folder: {folder}")
    return sorted(p.name for p in folder.glob("*.png"))


def random_recipe(
    rng: random.Random,
    *,
    bodies: list[str],
    eyes: list[str],
    hairs: list[str],
    outfits: list[str],
    accessories: list[str],
    accessory_chance: float,
) -> dict[str, str]:
    recipe = {
        "body": rng.choice(bodies),
        "eyes": rng.choice(eyes),
        "hairstyle": rng.choice(hairs),
        "outfit": rng.choice(outfits),
    }
    if accessories and rng.random() < accessory_chance:
        recipe["accessory"] = rng.choice(accessories)
    return recipe


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=32, help="Pool size (default: 32)")
    parser.add_argument("--seed", type=int, default=None, help="RNG seed for reproducible picks")
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=pkg_root / "assets" / "pool",
    )
    parser.add_argument("--generator-root", type=Path, default=None)
    parser.add_argument("--size", default="32x32")
    parser.add_argument("--no-accessory", action="store_true")
    parser.add_argument("--office", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--filter", type=Path, default=default_filter_path)
    parser.add_argument("--accessory-chance", type=float, default=None)
    parser.add_argument("--prefix", default="pool", help="Role prefix (default: pool → pool-01)")
    return parser.parse_args()


def default_generator_root() -> Path:
    return (pkg_root.parent.parent / "Character_Generator").resolve()


def main() -> int:
    args = parse_args()
    generator_root = (args.generator_root or default_generator_root()).resolve()
    if not generator_root.is_dir():
        print(f"Character Generator not found: {generator_root}", file=sys.stderr)
        print("Set CHARACTER_GENERATOR_ROOT to your local LimeZu Character_Generator directory.", file=sys.stderr)
        return 1

    rng = random.Random(args.seed)
    size = args.size
    pools = {
        "body": list_pieces(generator_root, "Bodies", size),
        "eyes": list_pieces(generator_root, "Eyes", size),
        "hairstyle": list_pieces(generator_root, "Hairstyles", size),
        "outfit": list_pieces(generator_root, "Outfits", size),
        "accessory": list_pieces(generator_root, "Accessories", size),
    }

    filter_doc: dict | None = None
    if args.office:
        filter_path = args.filter.resolve()
        filter_doc = json.loads(filter_path.read_text(encoding="utf-8"))
        pools = apply_office_filter(pools, filter_doc)
        print(f"Office filter: {filter_path}")

    accessory_chance = 0.0 if args.no_accessory else 1.0
    if not args.no_accessory:
        if args.accessory_chance is not None:
            accessory_chance = args.accessory_chance
        elif filter_doc and "accessoryChance" in filter_doc:
            accessory_chance = float(filter_doc["accessoryChance"])

    validate_pools(pools, require_accessory=accessory_chance >= 1.0)

    count = max(1, args.count)
    roles = [f"{args.prefix}-{i:02d}" for i in range(1, count + 1)]
    role_recipes: dict[str, dict[str, str]] = {}
    for role in roles:
        role_recipes[role] = random_recipe(
            rng,
            bodies=pools["body"],
            eyes=pools["eyes"],
            hairs=pools["hairstyle"],
            outfits=pools["outfit"],
            accessories=pools.get("accessory", []),
            accessory_chance=accessory_chance,
        )

    out_dir = args.out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    recipes_path = out_dir / "recipes.json"
    recipes_doc = {
        "characterGeneratorRoot": str(generator_root),
        "size": size,
        "seed": args.seed,
        "officeFilter": str(args.filter.resolve()) if args.office else None,
        "accessoryChance": accessory_chance,
        "roles": role_recipes,
    }
    recipes_path.write_text(json.dumps(recipes_doc, indent=2) + "\n", encoding="utf-8")

    cmd = [
        sys.executable,
        str(compose_script),
        "--recipes",
        str(recipes_path),
        "--generator-root",
        str(generator_root),
        "--out-dir",
        str(out_dir),
        "--roles",
        *roles,
    ]
    print("Running:", " ".join(cmd))
    subprocess.run(cmd, check=True)
    print(f"Pool recipes: {recipes_path}")
    if args.seed is not None:
        print(f"Seed: {args.seed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
