# 复盘登记看门狗

Gatehouse 检测到任务 **{{mission_id}}** 节点 **{{node_id}}** 的 retro session 已连续 **{{idle_seconds}} 秒** idle，但尚未调用 `gatehouse_retro_record` 登记完成。

## 请立即完成

1. 确认复盘报告已写入：`{{report_path}}`（含「工具与方法论」章节）。
2. 调用 **`gatehouse_retro_record()`**（或 `report_path=` 指向报告）。
3. 可选：`gatehouse_publish_blog(report_path={{report_path}})` 发布到 Portal 博客。

**不要** `gatehouse_send_message` 联系 {{architect_name}} — 全部 retro 节点登记后 Gatehouse 会自动通知 {{architect_name}} 汇总。
