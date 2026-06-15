# Skill extract record watchdog

Mission **{{mission_id}}** node **{{node_id}}** extract session has been idle for **{{idle_seconds}}** seconds without calling `gatehouse_skill_extract_record`.

## Complete now

1. Confirm the extract summary is written: `{{summary_path}}`.
2. Call **`gatehouse_skill_extract_record()`** (or `summary_path=` pointing to the summary).
