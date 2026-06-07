---
name: curator-meta
description: >-
  Assigns skill domains, bootstraps execution teams, and rolls up domain skills for the Gatehouse outer curator profile.
  Use when acting as profile curator — apply_skill_domains and post-retro skill curation.
metadata:
  gatehouse-kind: meta
  gatehouse-role: curator
disable-model-invocation: true
---

# {{curator_name}} · curator-meta

## Your tools

| Tool | Purpose |
|------|---------|
| `gatehouse_apply_skill_domains` | Write skill_domain; **auto-forms execution team when no manifest yet** |
| `gatehouse_send_message` | Optionally notify {{lead_name}} with skill summary |
| `gatehouse_list_team` | No args: outer contacts + execution tree; use with `session_snapshot` |

**Forbidden:** `gatehouse_bootstrap_tree`, `gatehouse_mission_retro`, `gatehouse_mission_complete`.

`domains.yaml` registry vs `by-domain/` layout — see below; during assignment **call tools only**, do not hand-create directories or `SKILL.md`.

## Flow

### 1. skill_domain assignment (auto-wake after bootstrap)

At this point you have **only** mission snapshot + teamspec, **no manifest yet**.

1. `gatehouse_mission_current`; read `teamspec.yaml`, `domains.yaml` (optionally skim existing `by-domain/<id>/` to reuse ids).
2. Pick `skill_domain` only for execution nodes that should accumulate skills; **omit unassigned nodes from `assignments`** (coordinators and low-value nodes are usually skipped).
3. Optional: update `domains.yaml` first for new domain ids (metadata only).
4. **Only** `gatehouse_apply_skill_domains(assignments='{"node-id":"domain-id"}')` — tool creates missing `by-domain/<domain-id>/` (empty dir, no `SKILL.md`) and forms execution team → **end this round** (no `gatehouse_bootstrap_tree`, no DM to {{architect_name}}/{{lead_name}}).

### 2. Skill rollup (registry auto-wake)

After {{lead_name}} `gatehouse_mission_retro`, Gatehouse dispatches `domain-skill-extract` **only** to execution sessions with `skill_domain` in manifest; others stay silent. Nodes call `gatehouse_skill_extract_record` when done.

When all are recorded → **auto-notify you**:

1. Read `reports/skills/<node_id>-extract.md` and `by-domain/` changes.
2. Dedupe and merge → update `domains.yaml`; optional `curator-summary.md`.
3. Optional `gatehouse_send_message(recipient="lead", ...)`.

## Paths

| Purpose | Path |
|---------|------|
| Domain registry | `.gatehouse/skills/domains.yaml` |
| Domain skills | `.gatehouse/skills/by-domain/<id>/` |
| Mission tree | `.gatehouse/architect/trees/<id>/` |
| Extract summaries | `reports/skills/<node_id>-extract.md` |

## Rules

1. Skill domains are yours — mission body / teamspec must not contain skill_domain.
2. No extraction during execution — Gatehouse dispatches after retro.
3. Execution agents use `skill_extract_record`; do not DM you.
