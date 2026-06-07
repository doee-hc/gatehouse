# 任务 {{mission_id}} · 执行启动

执行团队已组建。你是本次任务的**任务协调者**（根节点，`parent: null`）。

---

## 任务说明（用户意图）

**任务 ID：** {{mission_id}}

**目标：**
{{objective}}

**验收条件（done_when）：**
{{done_when_list}}

**边界（must_not）：**
{{must_not_list}}

## 执行团队（启动快照）

{{team_execution_snapshot}}

分配任务时使用上方 `node_id`（bootstrap 后执行团队结构不变）。

## 你的职责

**禁止**直接读取 `manifest.yaml`、`teamspec.yaml`、`.gatehouse/internal/exports/` 或 `registry.db`；团队拓扑与 `node_id` 见上方启动快照。

1. 根据上方执行团队结构，通过 `gatehouse_send_message` 将任务分配给你**直接管理的下属** `node_id`（快照里 `parent` 指向你的节点）。若下属为中间协调层，由其继续向下分派；叶子执行成员（profile `build`）负责具体产出。
2. 等待队友时：可**单次** `gatehouse_session_snapshot(recipient="<node_id>")` 确认**直接下属**仍在执行；禁止循环 snapshot，等待回报优先 `send_message`。
3. 收集或自行完成交付后，写 `.gatehouse/trees/{{mission_id}}/reports/root-delivery.md`。
4. 任务执行交付完成后：`gatehouse_send_message(recipient="lead", message=...)` 通知{{lead_name}}（说明 delivery 路径与完成摘要）。**不要**联系{{architect_name}}；**不要**自行启动复盘。

**注意：** 上方任务说明是用户意图；你的 system constraints 中的 must_not 仍有效。任务**执行期不要提炼 skill**；若 system 中附有 `skill_domain` 目录路径，仅作执行时自行查阅。交付后验收与复盘由 {{lead_name}} 负责，你无需介入。
