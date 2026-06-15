# by-domain · domain skill storage

One folder per **domain** (e.g. `mbist/`, `scan/`). Each skill is a subdirectory with `SKILL.md`.

## Domain registry

Repository-wide domain list: `.gatehouse/skills/domains.yaml` (read by profile lead / {{lead_name}} when planning missions).

## Per-skill conventions

- **Granularity:** one business action + minimal closed loop.
- **Naming:** verb-noun slug, e.g. `resolve-tessent-c9-drc`.
- **Frontmatter:** trigger and forbidden scenarios.
- **Size:** 1k–3k token body.
- **Timing:** only after {{lead_name}} accepts delivery and runs `gatehouse_mission_retro`; Gatehouse creates **extract sessions** (`build-extract`) for assigned nodes and dispatches `domain-skill-extract.md`; after all extract complete, **verify sessions** (`build-verify`) run automatically.
- **Loading:** at execution time use `skill({ name: "<slug>" })` or read `SKILL.md`; frontmatter may include `metadata.gatehouse-domain`.

## Context strategy

Execution bootstrap injects a **semantic top-k skill catalog** (with scores), not the full domain listing; manifest `skill_domain` gives the domain id and directory path — agents read the `SKILL.md` files they need.
