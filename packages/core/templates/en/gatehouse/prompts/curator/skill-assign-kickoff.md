# skill_domain assignment · Mission {{mission_id}}

{{assignment_intro}}

{{mission_contract}}

## Execution team structure

{{team_structure_summary}}

## Domain registry

{{domains_registry}}

## Forbidden this phase

- **Do not** read/write `.gatehouse/skills/**` or `.gatehouse/missions/**/reports/**`
- **Do not** call `gatehouse_submit_orchestration` or send messages

Follow **curator-meta**: pick existing `domain_id` values from the registry above, then **only** call `gatehouse_apply_skill_domains` and end the round. Call `gatehouse_mission_info` to refresh the mission snapshot if needed.
