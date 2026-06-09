# Execution idle watchdog (solo executor)

Gatehouse detected Mission **{{mission_id}}** has been **idle for {{idle_seconds}} seconds** while still `running`.

Likely causes: work is done but delivery report or {{lead_name}} notification was missed; or execution stalled mid-task.

## Act now

1. Review the objective and done_when—confirm whether all work is complete.
2. If complete but not yet delivered:
   - Write `.gatehouse/trees/{{mission_id}}/reports/root-delivery.md`
   - `gatehouse_publish_blog(report_path=.gatehouse/trees/{{mission_id}}/reports/root-delivery.md)` to publish to Portal blog
   - `gatehouse_send_message(recipient="lead", message=...)` to notify {{lead_name}} (include delivery path and summary; this pauses the watchdog)
3. If work is not complete → resume execution, then deliver as above when done.
4. **If you already notified {{lead_name}} of completion** but were woken again → send one more: `Work complete, no reply needed` to close the watchdog.

**Note:** You are the sole executor—no teammate checks needed.
