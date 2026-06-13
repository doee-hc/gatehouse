---
name: retro-toolkit
description: >-
  Shared retro analysis methodology and reusable scripts for Gatehouse build-root / build-coordinator retro sessions.
  Use during mission retro when analyzing context/ dumps and promoting reusable retro tools.
metadata:
  gatehouse-kind: toolkit
  gatehouse-role: exec
disable-model-invocation: true
---

# Retro toolkit · retro-toolkit

You are a **coordinator in a retro fork session** (build-root, build-root-solo, or build-coordinator). During retro:

1. **Single source of truth** — `.gatehouse/trees/<mission_id>/context/` (`messages.json`, `timeline.md`, `metrics.json`, `subtree-metrics.json`).
2. **Do not read full context end-to-end** — start with `subtree-metrics.json` and `metrics.json`, grep `timeline.md`, sample `messages.json`, then dig into suspicious slices.
3. **Build custom tools** — Python scripts to extract features (compaction count, todo-phase tokens, send_message patterns, etc.). **Do not** wait for Gatehouse to compute semantic metrics.
4. **Persist tools** — effective scripts + docs go under `.gatehouse/skills/retro-toolkit/tools/<verb-noun>/` (see template below); next retro reads existing tools before extending.

## Dumped vs custom (boundary)

| Source | Use |
|--------|-----|
| `.gatehouse/trees/<mission_id>/context/` | Full raw messages + grep-friendly timeline — **primary input for features** |
| `.gatehouse/trees/<mission_id>/context/<node_id>/metrics.json` | Per-node session token/duration/tool aggregates (precomputed) |
| `.gatehouse/trees/<mission_id>/context/subtree-metrics.json` | Per retro coord subtree aggregates (`retro_nodes[<your node_id>]`) |
| Custom scripts + this skill | Semantic metrics derivable from messages/timeline |

## Recommended workflow

1. Read `.gatehouse/trees/<mission_id>/context/index.json` and `subtree-metrics.json` (`retro_nodes[<node_id>]`), list all branch `node_id`s.
2. Read `.gatehouse/skills/retro-toolkit/tools/*/SKILL.md`, reuse scripts.
3. For 1–2 suspicious nodes: grep timeline → write/run script → record findings.
4. If a new tool is reusable: add `.gatehouse/skills/retro-toolkit/tools/<name>/` with SKILL.
5. Write `.gatehouse/trees/<mission_id>/reports/nodes/<node_id>-retro.md` (include "Tool contribution" section) → `gatehouse_retro_record` (retro reports are internal — **do not** publish manually).

## New tool directory layout

```
.gatehouse/skills/retro-toolkit/tools/<verb-noun>/
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
