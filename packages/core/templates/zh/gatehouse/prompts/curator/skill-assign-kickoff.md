# skill_domain 分配 · 任务 {{mission_id}}

{{architect_name}} 已提交协作脚本。为需沉淀的执行节点选定 `skill_domain` 后，**仅**调用 `gatehouse_apply_skill_domains`。

{{mission_contract}}

## 执行团队结构摘要

{{team_structure_summary}}

## 领域注册表

{{domains_registry}}

## 本阶段禁止

- **禁止** `mkdir`、写文件、改 `by-domain/**/SKILL.md`（领域目录由工具创建）
- **禁止** `gatehouse_bootstrap_tree`、私信 {{architect_name}} / {{lead_name}}

## 步骤

1. 按上方各节点 `description` 与职责决定是否在 `assignments` 中列入 `skill_domain`（**未列入 = 不分配**，复盘期也不会收到 skill 提炼系统消息）。任务快照中 `user_skill` 有值须遵守；**无该字段则全权自行决定**，勿期待 {{lead_name}} 提供 skill hint。
2. 若使用仓库中尚未登记的 domain-id：可先更新 `domains.yaml`（仅元数据）。
3. `gatehouse_apply_skill_domains(assignments='{"node-id":"domain-id"}')` → **结束本轮**。

中间协调节点、无沉淀价值的通用执行节点通常**不**列入 `assignments`。执行期不提炼 skill。若任务快照有变，可调用 `gatehouse_mission_info` 刷新。
