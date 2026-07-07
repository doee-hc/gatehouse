# by-domain · domain skill storage

One folder per **domain** (e.g. `mbist/`, `scan/`). Each skill is a subdirectory with `SKILL.md`.

## Domain registry

Repository-wide domain list: `.gatehouse/skills/domains.yaml` (read by profile lead / {{lead_name}} when planning missions).

## Per-skill conventions

Format, naming, size, and extraction rules live in the global template `.gatehouse/<locale>/prompts/architect/domain-skill-extract.md` (`<locale>` from `.gatehouse/config.yaml`).

## Context strategy

Execution bootstrap injects a **semantic top-k skill catalog** (with scores), not the full domain listing; manifest `skill_domain` gives the domain id and directory path — agents read the `SKILL.md` files they need.
