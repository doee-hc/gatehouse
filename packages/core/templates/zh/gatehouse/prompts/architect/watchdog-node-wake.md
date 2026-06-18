# Execution watchdog

Mission **{{mission_id}}** node **{{node_id}}** is **running** but the session has been idle for **{{idle_seconds}}** seconds.

## Act now

1. If your current work order is **done**:
   - **`gatehouse_execution_complete(summary=..., artifacts=[{path,description}], risks=?, force_reason=?, evidence=?)`** — list artifact paths only.
2. 若你是 **terminal 节点**且尚未提交交付：
   - Confirm all nodes are done, then call **`gatehouse_execution_complete`**.
3. If work is **not done** → resume immediately.

This alert is only to unblock **this node**.
