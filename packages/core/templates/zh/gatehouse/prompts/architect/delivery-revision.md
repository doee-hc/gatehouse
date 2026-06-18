# Delivery revision · Mission {{mission_id}}

Delivery v{{from_version}} did not pass acceptance. Re-orchestrate `mission.script.ts` for the revision scope (may resume from completed-node baseline).

## Revision scope

{{revision_body}}

## Act now

1. 调用 `gatehouse_mission_info` 查看任务快照与当前执行进度（已完成节点、基线等）。
2. Update `.gatehouse/trees/{{mission_id}}/mission.script.ts` to cover **only the revision** (skip `done` leaves; reference their output via `dependsOn` in later steps).
3. Save, then **`gatehouse_submit_orchestration(mode=continue)`**.
4. If topology adds nodes, ensure new nodes have `skill_domain` assigned before `prompt`.
