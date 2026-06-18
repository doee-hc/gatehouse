# skill_domain 分配 · 任务 {{mission_id}}

为需沉淀的执行节点选定 `skill_domain` 后，**仅**调用 `gatehouse_apply_skill_domains`。

{{mission_contract}}

## 执行团队结构摘要

{{team_structure_summary}}

## 领域注册表

{{domains_registry}}

## 本阶段禁止

- **禁止**编辑 `by-domain/**/SKILL.md`
- **禁止** `gatehouse_submit_orchestration`、发消息

## 步骤

1. 按各节点 `description` 与职责决定 `assignments`（**未列入 = 不分配**）。`user_skill` 有值须遵守；否则自行决定。
2. 新 domain-id 可先更新 `domains.yaml`（仅元数据）。
3. `gatehouse_apply_skill_domains(assignments='{"node-id":"domain-id"}')` → **结束本轮**。

汇总/协调节点、无沉淀价值的节点通常**不**列入 `assignments`。可调用 `gatehouse_mission_info` 刷新任务快照。
