# Execution watchdog

Gatehouse detected Mission **{{mission_id}}** node **{{node_id}}** is marked **running** in orchestration but its session has been **idle for {{idle_seconds}} seconds**.

Likely causes: work finished but `gatehouse_execution_complete` was not called; or execution stalled mid-task.

## Do now

1. If your work for the current work order is **complete**:
   - Write or confirm your delivery report at `{{delivery_path}}` when applicable.
   - Call **`gatehouse_execution_complete(summary=..., delivery_path=...)`**.
2. If you are the structural root and delivery to {{lead_name}} is still pending:
   - Write `.gatehouse/trees/{{mission_id}}/reports/root-delivery.md` (reference child `-delivery.md` paths — do not copy bodies).
   - **`gatehouse_delivery_submit(...)`** then **`gatehouse_execution_complete`** if the script waits on you.
3. If work is **not** complete → resume execution now.

**Do not** spam teammates. This watchdog only unblocks **this node's** stalled orchestration step.
