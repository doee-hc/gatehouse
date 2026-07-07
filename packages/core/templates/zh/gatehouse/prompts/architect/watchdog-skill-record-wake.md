# Skill 提炼登记 watchdog

Mission **{{mission_id}}** 节点 **{{node_id}}** 的 extract session 已空闲 **{{idle_seconds}}** 秒，尚未调用 `gatehouse_skill_extract_record`。

## 请立即完成

1. 确认提炼摘要已写入：`{{summary_path}}`。
2. 调用 **`gatehouse_skill_extract_record()`**（或通过 `summary_path=` 指向摘要）。
