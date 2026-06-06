---
name: retro-toolkit
description: >-
  Shared retro coord methodology and custom analysis tools. Discover issues from raw context/,
  extract features with scripts; persist tool docs as skills for reuse.
---

# Retro toolkit · retro-toolkit

You are a **coord in a retro fork session** (build-coordinator). During retro:

1. **Single source of truth** — your branch's `context/` (`messages.json`, `timeline.md`, `metrics.json`, `subtree-metrics.json`).
2. **Do not read full context end-to-end** — start with `subtree-metrics.json` and `metrics.json`, grep `timeline.md`, sample `messages.json`, then dig into suspicious slices.
3. **Build custom tools** — Python scripts to extract features (compaction count, todo-phase tokens, send_message patterns, etc.). **Do not** wait for Gatehouse to compute semantic metrics.
4. **Persist tools** — effective scripts + docs go under `tools/<verb-noun>/` (see template below); next retro reads existing tools before extending.

## Dumped vs custom (boundary)

| Source | Use |
|--------|-----|
| `context/` dumps | Full raw messages + grep-friendly timeline — **primary input for features** |
| `context/*/metrics.json` | Per-node session token/duration/tool aggregates (precomputed) |
| `context/subtree-metrics.json` | Per retro coord subtree aggregates (`retro_nodes[<your node_id>]`) |
| Custom scripts + this skill | Semantic metrics derivable from messages/timeline |

## Recommended workflow

1. Read `context/index.json` and `context/subtree-metrics.json` (`retro_nodes[<node_id>]`), list all branch `node_id`s.
2. Read `.gatehouse/architect/retro-toolkit/tools/*/SKILL.md`, reuse scripts.
3. For 1–2 suspicious nodes: grep timeline → write/run script → record findings.
4. If a new tool is reusable: add `tools/<name>/` with SKILL.
5. Write `reports/nodes/<node_id>-retro.md` (include "Tools & methodology") → `gatehouse_retro_record` → `gatehouse_publish_blog(report_path=.gatehouse/architect/trees/<mission_id>/reports/nodes/<node_id>-retro.md)`.

## New tool directory layout

```
.gatehouse/architect/retro-toolkit/tools/<verb-noun>/
  SKILL.md          # purpose, I/O, example command, problem class
  analyze.py        # or other scripts
```

`SKILL.md` must include: **problem class**, **which context paths**, **how to run**, **output field meanings**.

## Problem classes (hints, not exhaustive)

- Context compaction frequency and post-compaction behavior
- Todo-phase token spend vs output
- send_message / coordination gaps
- Tool failure and retry loops
- Mid-mission user intervention and weak prompt constraints
- Overlapping responsibilities within branch
