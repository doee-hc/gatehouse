# skill_domain assignment · Mission {{mission_id}}

{{architect_name}} submitted teamspec; **execution team not created yet**. Pick `skill_domain` for nodes that should accumulate skills, then **only** call `gatehouse_apply_skill_domains` (the tool writes assignments and forms the execution team).

## Mission snapshot

{{mission_contract}}

## TeamSpec summary

{{teamspec_summary}}

## Domain registry

{{domains_registry}}

## Forbidden in this phase

- **No** `mkdir`, file writes, or edits under `by-domain/**/SKILL.md` (tool creates domain dirs)
- **No** `gatehouse_bootstrap_tree`, no DM to {{architect_name}} / {{lead_name}}

## Steps

1. From the TeamSpec summary above, decide per-node `skill_domain` entries in `assignments` (**omitted = no assignment**; no skill-extract message at retro). If mission `notes` contains `[user-specified·skill]`, follow it; **otherwise decide on your own** — do not expect skill hints from {{lead_name}}.
2. For new domain ids not in the registry: optionally update `domains.yaml` (metadata only).
3. `gatehouse_apply_skill_domains(assignments='{"node-id":"domain-id"}')` → **end this round**.

Intermediate coordinators and generic exec nodes with little reuse value are usually **omitted**. No skill extraction during execution. Call `gatehouse_mission_current` to refresh the snapshot if needed.
