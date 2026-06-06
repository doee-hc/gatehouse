# skill_domain assignment · Mission {{mission_id}}

{{architect_name}} submitted teamspec; **execution team not created yet**. Pick `skill_domain` for nodes that should accumulate skills, then **only** call `gatehouse_apply_skill_domains`; the tool writes assignments, creates missing `by-domain/<domain-id>/` dirs (no `SKILL.md`), forms the team, and kicks the task coordinator.

**Objective:** {{objective}}

## Forbidden this phase

- **No** `mkdir`, file writes, or edits to `by-domain/**/SKILL.md` (dirs created by tool)
- **No** `gatehouse_bootstrap_tree`, no DM to {{architect_name}} / {{lead_name}}

## Inputs

- `gatehouse_mission_current` — full task text
- `.gatehouse/architect/trees/{{mission_id}}/teamspec.yaml`
- `.gatehouse/skills/domains.yaml` (read-only, pick existing domain ids)

## Steps

1. Per node `constraints`, decide whether to include `skill_domain` in `assignments` (**omitted = no assignment**; no skill extract message at retro).
2. For new domain ids not in repo: optionally update `domains.yaml` (metadata only).
3. `gatehouse_apply_skill_domains(assignments='{"node-id":"domain-id"}')` → **end this round**.

Skip coordinators and generic executors with no skill value. No skill extraction during execution.
