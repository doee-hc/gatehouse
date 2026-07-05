# Execution watchdog

Mission **{{mission_id}}** node **{{node_id}}** is **running** but the session has been idle for **{{idle_seconds}}** seconds.

## Act now

1. If your current work order is **done**:
   - **`gatehouse_execution_complete(summary=..., force_reason=?, evidence=?)`**
2. If you are the **terminal node** and have not submitted delivery:
   - Confirm all nodes are done, then call **`gatehouse_execution_complete`**.
3. If work is **not done** → resume immediately.

This alert is only to unblock **this node**.
