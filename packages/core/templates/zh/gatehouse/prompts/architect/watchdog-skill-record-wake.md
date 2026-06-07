# Skill 提炼登记看门狗

Gatehouse 检测到任务 **{{mission_id}}** 节点 **{{node_id}}** 的执行 session 已连续 **{{idle_seconds}} 秒** idle，但尚未调用 `gatehouse_skill_extract_record` 登记完成。

## 请立即完成

1. 确认提炼摘要已写入：`{{summary_path}}`。
2. 调用 **`gatehouse_skill_extract_record()`**（或 `summary_path=` 指向摘要）。

**不要** 私信 {{curator_name}} — 全部节点登记后 Gatehouse 会自动通知 {{curator_name}} 汇总。
