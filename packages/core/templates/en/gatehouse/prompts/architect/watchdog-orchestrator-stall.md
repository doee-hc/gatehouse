# Orchestrator stall

Mission **{{mission_id}}** orchestration has been stalled for **{{stale_minutes}}** minutes (current phase: **{{phase}}**).

## Act now

1. Read `.gatehouse/trees/{{mission_id}}/mission.script.ts` — fix unescaped `"` inside double-quoted strings; parallel siblings need **sequential** `ctx.waitFor`.
2. After fixes, call **gatehouse_submit_orchestration**.
3. If submit fails after major script changes, fix the script or ask {{lead_name}} before restarting.
4. Use **gatehouse_execution_status** to check node state.

**Do not** skip incomplete orchestration — finish script fixes and resubmit first.
