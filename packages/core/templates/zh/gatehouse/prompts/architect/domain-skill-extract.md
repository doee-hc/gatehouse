# 领域 skill 提炼（复盘启动 · Gatehouse 系统消息）

{{lead_name}}已确认交付完成并启动任务 `{{mission_id}}` 复盘。请根据**本次执行经验**提炼领域 skill。

**你的节点：** {{node_id}}
**本节点 skill 领域：** `{{skill_domain}}`

## 领域目录（自行查阅，勿期望全文注入）

`{{skill_domain_path}}/`

提炼前先 **read** 该目录下已有 `*/SKILL.md`；**有则合并更新**，无则新建子目录。

{{skill_domain_existing_section}}

## 约束

- **只在你亲历执行过的步骤上**创建 skill 目录和 `SKILL.md`
- **不要**为未实际执行的步骤或其它 `skill_domain` 预建空目录（无 `SKILL.md` 的目录会被自动清理）
- **不要**创建不属于 `{{skill_domain}}` 领域的 skill 目录
- **不要**批量 `mkdir` 清单中的全部 slug；仅在为某步骤写出 `SKILL.md` 时创建对应子目录

## 提炼原则

1. **单一业务动作 + 最小知识闭环** — 每个 skill 只解决一个核心问题。
2. **命名** — 子目录 slug 强制「动词+名词」，如 `resolve-tessent-c9-drc`、`capture-waveform-glitch-time`。
3. **格式** — OpenCode `SKILL.md`：YAML frontmatter 含 `name`、`description`，并写清 **触发场景** 与 **禁止场景**。
4. **体量** — 单文件正文严格 **1k–3k token**（以 Markdown 正文为主）。
5. **去重** — 不重复造轮子；合并时删任务一次性细节，保留可复用步骤与路径。

## 落盘路径

`{{skill_domain_path}}/<verb-noun-slug>/SKILL.md`

## 交付

1. 写 `.gatehouse/architect/trees/{{mission_id}}/reports/skills/{{node_id}}-extract.md` — 新建/更新的 skill 路径列表 + 各一行摘要。
2. 调用 **`gatehouse_skill_extract_record()`** 登记完成。

**不要** `gatehouse_send_message` 联系{{curator_name}} — 全部节点登记后 Gatehouse 会自动通知{{curator_name}}汇总。

**注意：** 本指引仅在复盘启动后由 Gatehouse 下发；任务执行期不应提前提炼 skill。
