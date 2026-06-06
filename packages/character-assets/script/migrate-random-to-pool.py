#!/usr/bin/env python3
"""Rename preview random-NN sheets to pool-NN (rewrite JSON frame keys). Local migration helper."""
from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path

pkg_root = Path(__file__).resolve().parent.parent


def rewrite_role_json(src_role: str, dst_role: str, src_path: Path, dst_path: Path) -> None:
    data = json.loads(src_path.read_text(encoding="utf-8"))
    prefix = f"{src_role}_"
    new_prefix = f"{dst_role}_"
    data["frames"] = {
        (new_prefix + key[len(prefix) :] if key.startswith(prefix) else key): value
        for key, value in data["frames"].items()
    }
    data.setdefault("meta", {})["image"] = f"{dst_role}-1x1.png"
    dst_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def migrate(src_dir: Path, dst_dir: Path, *, src_prefix: str, dst_prefix: str, count: int) -> None:
    dst_dir.mkdir(parents=True, exist_ok=True)
    pattern = re.compile(rf"^{re.escape(src_prefix)}-(\d{{2}})-1x1\.(png|json)$")
    for i in range(1, count + 1):
        src_role = f"{src_prefix}-{i:02d}"
        dst_role = f"{dst_prefix}-{i:02d}"
        for ext in ("png", "json"):
            src = src_dir / f"{src_role}-1x1.{ext}"
            dst = dst_dir / f"{dst_role}-1x1.{ext}"
            if not src.is_file():
                raise FileNotFoundError(f"Missing {src}")
            if ext == "png":
                shutil.copy2(src, dst)
            else:
                rewrite_role_json(src_role, dst_role, src, dst)
        print(f"{src_role} → {dst_role}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--src-dir",
        type=Path,
        default=pkg_root.parent / "portal" / "public" / "assets" / "characters" / "preview" / "random-16",
    )
    parser.add_argument("--dst-dir", type=Path, default=pkg_root / "assets" / "pool")
    parser.add_argument("--count", type=int, default=32)
    parser.add_argument("--src-prefix", default="random")
    parser.add_argument("--dst-prefix", default="pool")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    migrate(
        args.src_dir.resolve(),
        args.dst_dir.resolve(),
        src_prefix=args.src_prefix,
        dst_prefix=args.dst_prefix,
        count=args.count,
    )
    print(f"Wrote {args.count} roles to {args.dst_dir.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
