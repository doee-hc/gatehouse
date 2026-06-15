# Skill verify record watchdog

Mission **{{mission_id}}** node **{{node_id}}** verify session has been idle for **{{idle_seconds}}** seconds without calling `gatehouse_skill_verify_record`.

## Complete now

1. Confirm the verify report is written: `{{report_path}}`.
2. Fix `SKILL.md` if still not passing, then record.
3. Call **`gatehouse_skill_verify_record(passed=true)`** (or `report_path=` pointing to the report).
