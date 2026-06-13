# 执行看门狗

Gatehouse 检测到任务 **{{mission_id}}** 节点 **{{node_id}}** 标记为 **running**，但 session 已连续 **{{idle_seconds}} 秒** 无活动。

可能原因：工作已完成但未调用 `gatehouse_execution_complete`；或执行中途挂起。

## 请立即处理

1. 若当前工单工作**已完成**：
   - **`gatehouse_execution_complete(summary=..., artifacts=[{path,description}], risks=?, force_reason=?, evidence=?)`** — 产出在项目目录，artifacts 只列路径与描述。structural root 在全树 done 时自动通知 {{lead_name}}。
2. 若你是 structural root 且尚未向 {{lead_name}} 提交交付：
   - 确认全树 done 后调用上述 **`gatehouse_execution_complete`**。
3. 若工作**未完成** → 立即继续执行。

**勿**反复打扰队友。本提醒仅用于解除**本节点**卡住的步骤。
