# 执行节点 watchdog

Mission **{{mission_id}}** 节点 **{{node_id}}** 处于 **running**，但 session 已空闲 **{{idle_seconds}}** 秒。

## 请立即处理

1. 若当前工单**已完成**：
   - **`gatehouse_execution_complete(summary=..., force_reason=?, evidence=?)`**
2. 若你是 **terminal 节点**且尚未提交交付：
   - 确认全树节点均已完成后，调用 **`gatehouse_execution_complete`**。
3. 若工作**尚未完成** → 立即继续执行。

本提醒仅用于解除**本节点**阻塞。
