# skill_domain 分配 · 任务 {{mission_id}}

{{architect_name}}已提交 teamspec，**任务执行团队尚未创建**。为需沉淀的执行节点选定 `skill_domain` 后，**仅**调用 `gatehouse_apply_skill_domains`；工具会写入分配、自动创建缺失的 `by-domain/<domain-id>/` 目录（不含 `SKILL.md`）、组建执行团队并向任务协调者下发启动消息。

**目标：** {{objective}}

## 本阶段禁止

- **禁止** `mkdir`、写文件、改 `by-domain/**/SKILL.md`（领域目录由工具创建）
- **禁止** `gatehouse_bootstrap_tree`、私信 {{architect_name}} / {{lead_name}}

## 输入

- `gatehouse_mission_current` — 任务全文
- `.gatehouse/architect/trees/{{mission_id}}/teamspec.yaml`
- `.gatehouse/skills/domains.yaml`（只读，选已有 domain-id）

## 步骤

1. 按节点 `constraints` 决定是否在 `assignments` 中列入 `skill_domain`（**未列入 = 不分配**，复盘期也不会收到 skill 提炼系统消息）。
2. 若使用仓库中尚未登记的 domain-id：可先更新 `domains.yaml`（仅元数据）。
3. `gatehouse_apply_skill_domains(assignments='{"node-id":"domain-id"}')` → **结束本轮**。

中间协调节点、无沉淀价值的通用执行节点通常**不**列入 `assignments`。执行期不提炼 skill。
