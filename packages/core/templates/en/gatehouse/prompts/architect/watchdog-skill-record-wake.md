# Skill extract record watchdog

Gatehouse detected Mission **{{mission_id}}** node **{{node_id}}** execution session idle for **{{idle_seconds}}** seconds without calling `gatehouse_skill_extract_record`.

## Do now

1. Confirm extract summary is written: `{{summary_path}}`.
2. Call **`gatehouse_skill_extract_record()`** (or `summary_path=` pointing at the summary).

**Do not** DM {{curator_name}} — Gatehouse auto-notifies {{curator_name}} after all nodes record.
