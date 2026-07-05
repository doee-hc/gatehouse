# 领域 skill 提炼 · {{mission_id}}

{{lead_name}}已确认交付并启动复盘。以本节点 `context/` 与交付物为唯一数据源，勿依赖执行期记忆。

**你的节点：** {{node_id}}
**本节点 skill 领域：** `{{skill_domain}}`

## 数据来源（唯一真相源）

```
.gatehouse/missions/{{mission_id}}/context/{{node_id}}/
  messages.json
  timeline.md
  metrics.json
```

提炼前先 **grep** `timeline.md` 定位关键步骤，再 **read** 必要片段与交付物（`reports/`、`articles/` 等）。

## 领域目录

`{{skill_domain_path}}/`

提炼前先 **read** 已有 `*/SKILL.md`；**有则合并更新**，无则新建。

{{skill_domain_existing_section}}

## 约束

- 只基于 **context/ 与交付物** 中可证实的步骤创建 skill
- **不要**创建不属于 `{{skill_domain}}` 的 skill
- 每 mission 每 domain **最多新建 2 个** skill；高相似度（≥0.85）必须 merge
- 正文较长时须有**方法论结构**（步骤、触发条件）；勿写纯任务报告

## 提炼原则

1. **单一业务动作 + 最小知识闭环**
2. **命名** — slug 为「动词+名词」
3. **格式** — YAML frontmatter + **触发场景** + **禁止场景**
4. **体量** — 正文 1k–3k token
5. **去重 + 面向复用** — 丢弃特性级案例，保留通用分析步骤
6. **抽象层级** — 核心步骤**不应依赖特定产品名**；删掉所有产品名后框架仍须成立

## 落盘

`{{skill_domain_path}}/<verb-noun-slug>/SKILL.md`

## 交付

1. 写 `.gatehouse/missions/{{mission_id}}/reports/skills/{{node_id}}-extract.md`
2. **`gatehouse_skill_extract_record()`**

若登记被拒，读工具返回的 `issues`，修正 `SKILL.md` 后重试。误建的目录应删除。
