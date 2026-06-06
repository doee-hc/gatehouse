"""Filter LimeZu Character Piece filenames for office-appropriate random generation."""
from __future__ import annotations

import re
from typing import Any

SERIES_RE = re.compile(r"^(?:Body|Outfit|Hairstyle|Accessory)_(\d+)")


def piece_series(filename: str) -> int | None:
    match = SERIES_RE.match(filename)
    return int(match.group(1)) if match else None


def apply_layer_filter(filenames: list[str], rules: dict[str, Any] | None) -> list[str]:
    if not rules:
        return list(filenames)

    block_contains: list[str] = rules.get("blockNameContains") or []
    block_series: set[int] = set(rules.get("blockSeries") or [])
    allow_contains: list[str] = rules.get("allowNameContains") or []
    allow_series: set[int] = set(rules.get("allowSeries") or [])

    kept: list[str] = []
    for name in filenames:
        if any(token in name for token in block_contains):
            continue
        series = piece_series(name)
        if series is not None and series in block_series:
            continue
        if allow_series and (series is None or series not in allow_series):
            continue
        if allow_contains and not any(token in name for token in allow_contains):
            continue
        kept.append(name)
    return kept


def apply_office_filter(
    pools: dict[str, list[str]],
    filter_doc: dict[str, Any],
) -> dict[str, list[str]]:
    layer_keys = ("body", "eyes", "hairstyle", "outfit", "accessory")
    filtered: dict[str, list[str]] = {}
    for key in layer_keys:
        if key not in pools:
            continue
        rules = filter_doc.get(key)
        if isinstance(rules, dict):
            filtered[key] = apply_layer_filter(pools[key], rules)
        else:
            filtered[key] = list(pools[key])
    return filtered


def validate_pools(pools: dict[str, list[str]], *, require_accessory: bool) -> None:
    required = ["body", "eyes", "hairstyle", "outfit"]
    for key in required:
        if not pools.get(key):
            raise ValueError(f"Office filter removed all {key} pieces; relax office-piece-filter.json")
    if require_accessory and not pools.get("accessory"):
        raise ValueError("Office filter removed all accessory pieces; relax office-piece-filter.json accessory rules")
