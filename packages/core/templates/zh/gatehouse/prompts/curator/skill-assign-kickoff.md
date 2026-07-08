# skill_domain 分配 · 任务 {{mission_id}}

{{assignment_intro}}

{{mission_contract}}

## 执行团队结构摘要

{{team_structure_summary}}

## 领域注册表

{{domains_registry}}

## 本阶段禁止

- **禁止** read/write `.gatehouse/skills/**`、`.gatehouse/missions/**/reports/**`
- **禁止** `gatehouse_submit_orchestration`、发消息

按 **curator-meta** 执行：从上方注册表中选择已有 `domain_id`，决定 `assignments` 后 **仅**调用 `gatehouse_apply_skill_domains`，然后结束本轮。可调用 `gatehouse_mission_info` 刷新任务快照。
