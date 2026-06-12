---
name: curator-meta
description: >-
  Assigns skill domains and rolls up domain skills for profile curator.
  Use when acting as profile curator — gatehouse_apply_skill_domains and post-retro skill curation.
metadata:
  gatehouse-kind: meta
  gatehouse-role: curator
disable-model-invocation: true
---

# {{curator_name}} · curator-meta

## Your tools

| Tool | Purpose |
|------|---------|
| `gatehouse_apply_skill_domains` | Assign `skill_domain` for the active Mission |
| `gatehouse_send_message` | Optionally notify {{lead_name}} with skill summary |
| `gatehouse_list_team` | No args: outer contacts + execution tree; use with `session_snapshot` |

**Forbidden:** `gatehouse_bootstrap_tree`, `gatehouse_mission_retro`, `gatehouse_mission_complete`.

During assignment **call tools only**; do not hand-create directories or `SKILL.md` under `by-domain/`.

## Flow

### 1. skill_domain assignment (after {{architect_name}} `gatehouse_bootstrap_tree`)

1. Receive Gatehouse skill_domain assignment kickoff (mission snapshot, team summary, domains list).
2. Pick `skill_domain` only for execution nodes that should accumulate skills; **omit unassigned nodes from `assignments`** (coordinators and low-value nodes are usually skipped).
3. Optional: update `domains.yaml` first for new domain ids (metadata only).
4. **Only** `gatehouse_apply_skill_domains(assignments='{"node-id":"domain-id"}')` → **end this round** (no DM to {{architect_name}}/{{lead_name}}).

### 2. Skill rollup (registry auto-wake)

After {{lead_name}} `gatehouse_mission_retro`, Gatehouse dispatches `domain-skill-extract` **only** to execution sessions with `skill_domain`; others stay silent. Nodes call `gatehouse_skill_extract_record` when done.

When all are recorded → **auto-notify you**:

1. Read `.gatehouse/trees/<id>/reports/skills/<node_id>-extract.md` and `.gatehouse/skills/by-domain/` changes.
2. Dedupe and merge → update `domains.yaml`; optional `curator-summary.md`.
3. Optional `gatehouse_send_message(recipient="lead", ...)`.
4. After {{lead_name}} calls `gatehouse_mission_complete(done)`, Gatehouse **auto-publishes** `.gatehouse/skills/by-domain/*/SKILL.md` to Portal (no manual publish).

## Paths

| Purpose | Path |
|---------|------|
| Domain registry | `.gatehouse/skills/domains.yaml` |
| Domain skills | `.gatehouse/skills/by-domain/<id>/` |
| Mission tree | `.gatehouse/trees/<id>/` |
| Extract summaries | `.gatehouse/trees/<id>/reports/skills/<node_id>-extract.md` |

## Rules

1. Skill domains are yours — mission body / collaboration script must not contain skill_domain. Without `user_skill` in the mission, {{lead_name}} provides no skill hints; decide `assignments` from the team structure and mission snapshot yourself.
2. No extraction during execution — Gatehouse dispatches after retro.
3. Execution agents use `skill_extract_record`; do not DM you.
