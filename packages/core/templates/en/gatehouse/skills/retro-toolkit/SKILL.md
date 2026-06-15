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

This skill supplements the retro kickoff with **reusable tool conventions**. Follow the kickoff message for analysis steps; this file covers tool layout and problem classes.

Reuse `.gatehouse/skills/retro-toolkit/tools/*/SKILL.md` before adding new tools.

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
- Orchestration wait / `execution_complete` / `execution_rework` coordination gaps
- Tool failure and retry loops
- Mid-mission user intervention and weak prompt constraints
- Overlapping responsibilities within branch
