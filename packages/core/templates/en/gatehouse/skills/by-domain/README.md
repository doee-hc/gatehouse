# by-domain · domain skill storage

Skills are grouped by **domain** (e.g. `mbist/`, `scan/`). Each domain may have multiple skills; each skill is one subdirectory + `SKILL.md`.

## Domain registry

Repository-wide domain list: `.gatehouse/skills/domains.yaml` (read by profile lead / {{lead_name}} when planning Missions).

## Per-skill conventions

- **Granularity**: one business action + minimal knowledge loop per skill.
- **Naming**: subdirectory slug is verb+noun, e.g. `resolve-tessent-c9-drc`.
- **Frontmatter**: clear trigger and anti-trigger scenarios.
- **Size**: 1k–3k tokens body.
- **Timing**: only after {{lead_name}} accepts delivery and runs `gatehouse_mission_retro`; Gatehouse dispatches `.gatehouse/architect/meta-skill/prompts/domain-skill-extract.md` to execution sessions.

## Context policy

Neither execution nor retro injects full existing SKILL text into agent context; TeamSpec `skill_domain` only gives domain id and directory path — agents read on demand.
