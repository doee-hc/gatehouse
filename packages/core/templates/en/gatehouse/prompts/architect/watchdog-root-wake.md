# Execution team all-idle watchdog

Gatehouse detected that **all** execution sessions for Mission **{{mission_id}}** have been **idle for {{idle_seconds}} seconds** while the Mission is still `running`.

Likely causes: a node finished but did not `gatehouse_send_message` upstream; or all work is done but {{lead_name}} was not notified to pause the watchdog.

## Investigate now

**Note:** This fires when the **whole team** is abnormally idle; after assigning work, stop and wait—do not loop snapshot in normal flow.

{{team_execution_snapshot}}

{{non_root_node_ids}}

1. Use the execution team snapshot above (structure is fixed after bootstrap).
2. For **each non-root** `node_id` listed above, call `gatehouse_session_snapshot(recipient="<node_id>")` **once** (all-idle diagnosis may inspect any non-root node; single diagnosis, no polling loops).
3. Based on snapshots:
   - Teammate idle and work seems done → `gatehouse_send_message` nudge upstream or the task coordinator (or summarize yourself as coordinator).
   - Teammate idle but work incomplete → assign or follow up via `gatehouse_send_message` to your **direct reports** only (do not skip levels; if the blocker is deeper in a subtree, nudge that node's direct manager first).
   - Pending branches → keep assigning/following up with direct reports, then return to assign → wait mode.

## After checks

When all work is truly complete, handle {{lead_name}} notification (`gatehouse_send_message(recipient="lead", ...)` pauses the watchdog until {{lead_name}} or the team assigns again):

1. **If you have not notified {{lead_name}} yet** → write delivery report if needed, `gatehouse_publish_blog(report_path=.gatehouse/trees/{{mission_id}}/reports/root-delivery.md)` to publish to Portal blog, then send completion notice.
2. **If you already notified {{lead_name}}** → send one more: `Work complete, please do not reply` to close the watchdog.

**Note:** Do not spam busy teammates; do not keep snapshot polling after diagnosis.
