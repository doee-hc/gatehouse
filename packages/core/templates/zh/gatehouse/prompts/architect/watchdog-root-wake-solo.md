# 任务执行 idle 看门狗（单人执行）

Gatehouse 检测到任务 **{{mission_id}}** 已连续 **{{idle_seconds}} 秒** session 为 idle，但任务仍为 `running`。

可能原因：工作已全部完成但未写交付报告或未通知{{lead_name}}；或执行过程中停顿未继续。

## 请立即处理

1. 回顾任务目标与验收条件，确认工作是否已全部完成。
2. 若已完成但尚未交付：
   - 写 `.gatehouse/trees/{{mission_id}}/reports/root-delivery.md`
   - `gatehouse_publish_blog(report_path=.gatehouse/trees/{{mission_id}}/reports/root-delivery.md)` 发布到 Portal 博客
   - `gatehouse_send_message(recipient="lead", message=...)` 通知{{lead_name}}（含 delivery 路径与完成摘要；此操作会暂停看门狗）
3. 若工作尚未完成 → 继续执行，完成后按上一步交付。
4. **若此前已向{{lead_name}}发送过完成通知** 但仍被唤醒 → 再发一条：`已工作完成，请勿回复`，以关闭看门狗。

**注意：** 你是唯一执行者，无需排查队友。
