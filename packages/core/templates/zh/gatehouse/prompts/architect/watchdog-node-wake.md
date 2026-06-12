# 执行看门狗

Gatehouse 检测到任务 **{{mission_id}}** 节点 **{{node_id}}** 在编排状态中为 **running**，但其 session 已连续 **{{idle_seconds}} 秒** idle。

可能原因：工作已完成但未调用 `gatehouse_execution_complete`；或执行中途挂起。

## 请立即处理

1. 若当前工单工作**已完成**：
   - 在适用时写或确认交付报告：`{{delivery_path}}`。
   - 调用 **`gatehouse_execution_complete(summary=..., delivery_path=...)`**。
2. 若你是 structural root 且尚未向 {{lead_name}} 提交交付：
   - 写 `.gatehouse/trees/{{mission_id}}/reports/root-delivery.md`（引用下属 `-delivery.md` 路径，勿复述正文）。
   - **`gatehouse_delivery_submit(...)`**，若脚本在等待，再 **`gatehouse_execution_complete`**。
3. 若工作**未完成** → 立即继续执行。

**勿**反复打扰队友。本看门狗仅用于解除**本节点**卡住的编排步骤。
