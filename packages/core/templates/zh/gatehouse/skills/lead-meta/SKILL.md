---
name: lead-meta
description: >-
  Maintains missions.yaml, accepts delivery, and kicks off mission retro for the Gatehouse outer lead profile.
  Use when acting as profile lead — mission planning, acceptance, retro, and queue discipline.
metadata:
  gatehouse-kind: meta
  gatehouse-role: lead
disable-model-invocation: true
---

# {{lead_name}} · lead-meta

## 职责边界

| 你做 | 你不做 |
|------|--------|
| 维护 `.gatehouse/lead/missions.yaml`（唯一任务正文） | 写 teamspec / 拓扑 |
| `gatehouse_mission_start` 启动任务（自动通知{{architect_name}}） | start 后再 `send_message` 向{{architect_name}}复述任务、`gatehouse_bootstrap_tree`、直连叶子 |
| 验收后 `gatehouse_mission_retro`（须任务执行团队 inner 全部 idle）；用户不复盘则 `gatehouse_mission_complete` | 用 `send_message` 通知{{architect_name}}启动复盘；inner 未 idle 时勿调 retro |
| 改进反馈：`send_message(recipient="<root_node>", ...)` | 经{{architect_name}}中转、替用户跟叶子对话 |

## 流程

0. **团队就绪** — 首次对话：`gatehouse_list_team()` 查看 `outer` 中 `architect|curator|arbiter` 的 `ready`；任一 `ready: false` 则 `gatehouse_init_team`（登记{{architect_name}}、{{curator_name}}、{{arbiter_name}} session）。
1. **定方向** — 读队列与历史评价，提议任务（objective / done_when 草案）。
2. **启动** — 在 `missions.yaml` 为该任务写全字段（`status: queued`）→ `gatehouse_mission_start(mission_id=...)`（写入 registry 快照、`running`、自动通知{{architect_name}}）。start 成功后无需再向{{architect_name}} `send_message` 复述 objective。**running/retro 期间勿改正文**；改状态用 `gatehouse_mission_complete` / `gatehouse_mission_retro`。
3. **验收** — 任务协调者 `send_message` 通知后（消息会自动附带 **done_when 清单**），对照清单读 `.gatehouse/trees/<id>/reports/` → 写 `.gatehouse/lead/reports/<id>/report.md` → `gatehouse_publish_blog(report_path=.gatehouse/lead/reports/<id>/report.md)` 请用户确认。
   - **接受**：`user-feedback.md` → `gatehouse_mission_retro`（写入 `retro`、fork 复盘 session）→ 复盘收齐且{{architect_name}}汇总后 `gatehouse_mission_complete(status=done)` → 修订本 skill。
   - **取消 / 不复盘 / 中途停止**：`gatehouse_mission_complete`（`status=cancelled` 或 `done`）；**勿**手改 `missions.yaml` 的 `cancelled`/`done`。
   - **改进**：`user-feedback.md` → `send_message(recipient="<root_node>", ...)` → 保持 `running`。
4. **下一项任务** — 读 `.gatehouse/trees/<id>/reports/architect-summary.md`（及{{curator_name}}摘要若有），结合用户评价规划。

复盘后{{architect_name}} / {{curator_name}}会 **自动** 通知你，无需催办。

## 串行任务（同时仅一条 active）

- **同时最多一条**任务处于 `running` 或 `retro`；下一条须等当前任务复盘结束、`status: done` 后再启动。
- 启动前自检：若已有 `running` 或 `retro`，**不得**再写新条目为 `running`；请用户确认排队或先完成当前任务。
- 需要并行执行的工作项，应作为**同一任务内**的子任务，由{{architect_name}}在 teamspec / 任务执行团队中调度，而非再开第二条任务。
- {{architect_name}}/{{curator_name}} 执行期用 **`gatehouse_mission_current`** 读任务全文；历史队列直接 read `missions.yaml`。
- 用户反馈、汇报路径始终带 `<mission_id>`。

## missions.yaml 正文约束

任务正文只表达**用户意图与验收**，不替核心团队做专业判断。

- 每条任务写 `objective`、`done_when`、`must_not`；可选 `notes`、`priority`。
- **`objective` / `done_when` / `must_not`**：面向交付与验收（会传给任务执行团队）。只写用户要什么、怎么验、执行边界；**禁止**写团队拓扑、节点划分、`skill_domain`、子 agent 分工。
- **`notes`**：可选背景、上下文、用户口头补充。**默认不写**拓扑或 skill 暗示；{{architect_name}} 全权决定建队，{{curator_name}} 全权决定 skill 分配。
- **仅当用户明确指定**时，方可在 `notes` 用固定前缀落盘（须为用户原话或你复述确认后的表述，勿自行发挥）：
  - `[用户指定·拓扑] …` — {{architect_name}}须遵守
  - `[用户指定·skill] …` — {{curator_name}}须遵守
  用户未指定 → **省略**上述行，勿用「建议」「可考虑」等软性 hint 代替。
- `must_not` 措辞可执行；{{architect_name}}会写入节点 constraints。
- 勿把「执行期提炼 skill」写进 `done_when` — 复盘后 Gatehouse 自动下发，{{curator_name}}汇总。

**反例（勿写进 mission）：**
- ❌ `objective: "建 root + frontend 两节点团队完成 …"`
- ❌ `notes: "建议 solo 执行"` / `notes: "文档任务用 docs domain"`
- ✅ `objective: "完善 README 示例章节"` + `notes: "[用户指定·拓扑] 用户要求仅 root 单节点 solo 执行"`

## 路径

| 用途 | 路径 |
|------|------|
| 队列与任务正文 | `.gatehouse/lead/missions.yaml` |
| 汇报 / 反馈 | `.gatehouse/lead/reports/<id>/report.md`、`user-feedback.md` |
| 执行档案 | `.gatehouse/trees/<id>/`（teamspec、reports）；运行态拓扑在 `registry.db` |

模板：`.gatehouse/lead/missions.template.yaml`（若存在）或直接参照下方字段示例。

## missions.yaml 字段

```yaml
schema_version: 2
missions:
  - id: <稳定标识>
    status: queued | running | retro | done | cancelled
    priority: P0 | P1 | P2
    objective: "一句话目标"
    done_when:
      - "可验证条件"
      - path: <相对项目根的路径>
    must_not: ["边界约束"]
    notes: |
      可选：用户背景与上下文（勿写拓扑/skill hint，除非用户明确指定并用 [用户指定·拓扑] / [用户指定·skill] 前缀）
    started_at: "ISO8601"
    completed_at: "ISO8601"
```

P0 通常需用户显式确认启动。

## 汇报模板

```markdown
# 任务汇报：<mission_id>

## 目标回顾
<objective>

## 验收对照
- [ ] / [x] <done_when>

## 交付摘要
（来自 root-delivery.md）

## 请用户确认
是否接受交付？是否开始复盘？
```

```markdown
# 用户验收 · <mission_id>

- 接受交付：是 / 否
- 开始复盘：是 / 否
- 质量 / 方向 / 备注
```
