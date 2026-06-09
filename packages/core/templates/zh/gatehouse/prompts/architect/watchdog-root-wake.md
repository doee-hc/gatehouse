# 任务执行团队全员 idle 看门狗

Gatehouse 检测到任务 **{{mission_id}}** 的执行团队已连续 **{{idle_seconds}} 秒**全体 session 为 idle，但任务仍为 `running`。

可能原因：某节点已完成任务但未向上级 `gatehouse_send_message` 汇报，导致任务协调者或中间协调层仍在等待；或工作已全部完成但未正确通知{{lead_name}}以暂停看门狗。

## 请立即排查

**注意：** 本消息由看门狗在**整个执行团队异常 idle** 时触发；正常分配任务后应停手等待，勿在日常流程中循环 snapshot。

{{team_execution_snapshot}}

{{non_root_node_ids}}

1. 使用上方执行团队快照（bootstrap 后结构不变）。
2. 对上方列出的每个 **非根** `node_id` **各调用一次** `gatehouse_session_snapshot(recipient="<node_id>")` 排查卡点（全员 idle 排查时可查看任意非根节点；单次诊断，禁止重复轮询）。
3. 根据 snapshot 决定后续：
   - 队友 idle 且任务似已完成 → `gatehouse_send_message` 向其上级或任务协调者补发汇报（或你作为任务协调者直接汇总）。
   - 队友 idle 但任务未完成 → 向**直接管理的下属** `gatehouse_send_message` 分配任务或跟进（勿越级派发；若卡点在其子树内，先催其直接上级）。
   - 仍有下属分支未交付 → 向直接下属继续分配或跟进，完成后回到「分配任务 → 停手等待消息」模式。

## 检查工作完成后

确认任务已全部执行完毕后，处理对{{lead_name}}的通知（`gatehouse_send_message(recipient="lead", ...)` 会暂停看门狗，直至{{lead_name}}或执行团队再次分配任务）：

1. **若尚未向{{lead_name}}发送过完成通知**（含此前漏发、仅口头汇总未调用工具等情况）→ 按需写交付报告、`gatehouse_publish_blog(report_path=.gatehouse/trees/{{mission_id}}/reports/root-delivery.md)` 发布到 Portal 博客后补发一条完成通知。
2. **若此前已向{{lead_name}}发送过完成通知** → 再向{{lead_name}}发送一条：`已工作完成，请勿回复`，以关闭看门狗。

**注意：** 等待期间勿反复 `send_message` 催促仍在 busy 的队友；排查完成后勿持续 snapshot 轮询。
