# skill_domain assignment · Mission {{mission_id}}

Pick `skill_domain` for nodes that should accumulate skills, then **only** call `gatehouse_apply_skill_domains`.

{{mission_contract}}

## Team structure summary

{{team_structure_summary}}

## Domain registry

{{domains_registry}}

## Forbidden this phase

- **Do not** edit `by-domain/**/SKILL.md`
- **Do not** `gatehouse_submit_orchestration` or send messages

## Steps

1. Decide `assignments` from each node's `description` and role (**omitted = unassigned**). Follow `user_skill` when set; otherwise decide yourself.
2. New domain ids: optionally update `domains.yaml` first (metadata only).
3. `gatehouse_apply_skill_domains(assignments='{"node-id":"domain-id"}')` → **end this round**.

Rollup/coordination nodes and low-value nodes are usually **omitted**. Call `gatehouse_mission_info` to refresh the mission snapshot if needed.
