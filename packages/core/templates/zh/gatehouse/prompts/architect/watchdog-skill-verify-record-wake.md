# Skill 验证登记 watchdog

Mission **{{mission_id}}** 节点 **{{node_id}}** 的 verify session 已空闲 **{{idle_seconds}}** 秒，尚未调用 `gatehouse_skill_verify_record`。

## 请立即完成

1. 确认验证报告已写入：`{{report_path}}`。
2. 若仍未通过，修正 `SKILL.md` 后重试。
3. 调用 **`gatehouse_skill_verify_record(passed=true)`**（或通过 `report_path=` 指向报告）。
