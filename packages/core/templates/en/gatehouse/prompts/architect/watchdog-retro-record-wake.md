# Retro record watchdog

Gatehouse detected Mission **{{mission_id}}** node **{{node_id}}** retro session idle for **{{idle_seconds}}** seconds without calling `gatehouse_retro_record`.

## Do now

1. Confirm retro report is written: `{{report_path}}` (include "Tool contribution" section).
2. Call **`gatehouse_retro_record()`** (or `report_path=` pointing at the report).
3. Retro reports are internal — **do not** `gatehouse_publish_blog`.

**Do not** `gatehouse_send_message` {{architect_name}} — Gatehouse auto-notifies {{architect_name}} after all retro nodes record.
