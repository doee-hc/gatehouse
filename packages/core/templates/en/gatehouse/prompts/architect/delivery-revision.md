# Delivery revision · Mission {{mission_id}}

Delivery v{{from_version}} did not pass acceptance. Re-orchestrate `mission.script.ts` for the revision scope (may resume from completed-node baseline).

## Revision scope

{{revision_body}}

## Act now

1. Call `gatehouse_mission_info` for the mission snapshot and current progress (completed nodes, baseline).
2. Update `.gatehouse/missions/{{mission_id}}/mission.script.ts` to cover **only the revision** (skip `done` leaves; reference their output via `dependsOn` in later steps).
3. Save, then **`gatehouse_submit_orchestration(mode=continue)`**.
4. If the script adds nodes, ensure the curator assigns `skill_domain` via `gatehouse_apply_skill_domains` before `ctx.run` activates them.
