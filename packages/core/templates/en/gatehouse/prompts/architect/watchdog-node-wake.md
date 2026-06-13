# Execution watchdog

Gatehouse detected Mission **{{mission_id}}** node **{{node_id}}** is marked **running** but its session has been **idle for {{idle_seconds}} seconds**.

Likely causes: work finished but `gatehouse_execution_complete` was not called; or execution stalled mid-task.

## Do now

1. If your work for the current work order is **complete**:
   - **`gatehouse_execution_complete(summary=..., artifacts=[{path,description}], risks=?, force_reason=?, evidence=?)`** — deliverables live in the project; list paths and descriptions only. Structural root: when all nodes are done, this also notifies {{lead_name}}.
2. If you are the structural root and delivery to {{lead_name}} is still pending:
   - Ensure all nodes are done, then call **`gatehouse_execution_complete`** as above.
3. If work is **not** complete → resume execution now.

**Do not** spam teammates. This reminder only unblocks **this node's** stalled step.
