---
name: lead-meta
description: >-
  维护 missions.yaml、验收交付、启动复盘。在 profile lead 下使用 — 任务规划、验收、复盘与串行队列纪律。
metadata:
  gatehouse-kind: meta
  gatehouse-role: lead
disable-model-invocation: true
---

# {{lead_name}} · lead-meta

## 职责边界

| 你做 | 你不做 |
|------|--------|
| 维护 `.gatehouse/lead/missions.yaml`（唯一任务正文） | 写协作脚本 / 拓扑 |
| `gatehouse_mission_start` 启动任务（自动通知{{architect_name}}） | start 后再 `send_message` 向{{architect_name}}复述任务、`gatehouse_bootstrap_tree`、直连叶子 |
| 验收后 `gatehouse_mission_retro`（须任务执行团队 inner 全部 idle）；用户不复盘则 `gatehouse_mission_complete` | 用 `send_message` 通知{{architect_name}}启动复盘；inner 未 idle 时勿调 retro |
| 改进反馈：`send_message(recipient="<root_node>", ...)` | 经{{architect_name}}中转、替用户跟叶子对话 |

## 流程

0. **团队就绪** — 首次对话：`gatehouse_list_team()` 查看 `outer` 中 `architect|curator|arbiter` 的 `ready`；任一 `ready: false` 则 `gatehouse_init_team`（登记{{architect_name}}、{{curator_name}}、{{arbiter_name}} session）。
1. **定方向** — 读队列与历史评价，提议任务（objective / done_when 草案）。
2. **启动** — 在 `missions.yaml` 为该任务写全字段（`status: queued`）→ `gatehouse_mission_start(mission_id=...)`（写入 registry 快照、`running`、自动通知{{architect_name}}）。start 成功后无需再向{{architect_name}} `send_message` 复述 objective。**running/retro 期间勿改正文**；改状态用 `gatehouse_mission_complete` / `gatehouse_mission_retro`。
3. **验收** — 任务协调者 `gatehouse_delivery_submit` 后（`delivery.yaml` 含 precheck 与 `pending_publish_paths`；**尚未**上 Portal）→ `gatehouse_delivery_status` + 读 `root-delivery.md` 与项目内 `publish:` 交付物 → **在对话中请用户对照确认**（可选简短本地验收记录）。
   - **接受**：用户确认后可选 `gatehouse_mission_retro` → 复盘收齐后 `gatehouse_mission_complete(status=done, user_feedback=...)`（`user_feedback` 可选，记用户原话；系统自动将 `publish:` 交付物发布到 Portal 并收尾）→ 修订本 skill。
   - **直接完成（不复盘）**：`gatehouse_mission_complete(status=done)` — 向用户说明：**将跳过 skill 提炼**（{{curator_name}} 已登记的 domain 不会生成 `by-domain/*/SKILL.md`）。
   - **取消 / 中途停止**：`gatehouse_mission_complete`（`status=cancelled` 或 `done`）；**勿**手改 `missions.yaml` 的 `cancelled`/`done`。
   - **返工**：`gatehouse_delivery_review(decision=revision_requested, failed_criteria=..., revision_brief=..., user_feedback=...)`（`revision_brief` 必填；`user_feedback` 可选原话；系统通知 root）→ 保持 `running`。
4. **下一项任务** — 读 `.gatehouse/trees/<id>/reports/architect-summary.md`（及{{curator_name}}摘要若有），结合用户评价规划。

复盘后{{architect_name}} / {{curator_name}}会 **自动** 通知你，无需催办。

## 串行任务（同时仅一条 active）

- **同时最多一条**任务处于 `running` 或 `retro`；下一条须等当前任务复盘结束、`status: done` 后再启动。
- 启动前自检：若已有 `running` 或 `retro`，**不得**再写新条目为 `running`；请用户确认排队或先完成当前任务。
- 需要并行执行的工作项，应作为**同一任务内**的子任务，由{{architect_name}}在协作脚本 / 任务执行团队中调度，而非再开第二条任务。
- {{architect_name}}/{{curator_name}} 执行期用 **`gatehouse_mission_current`** 读任务全文；历史队列直接 read `missions.yaml`。
- 用户反馈、汇报路径始终带 `<mission_id>`。

## missions.yaml 正文约束

任务正文只表达**用户意图与验收**，不替核心团队做专业判断。

- 每条任务写 `objective`、`done_when`、`must_not`；可选 `notes`、`user_topology`、`user_skill`、`priority`。
- **`objective` / `done_when` / `must_not`**：面向交付与验收（会传给任务执行团队）。只写用户要什么、怎么验、执行边界；**禁止**写团队拓扑、节点划分、`skill_domain`、子 agent 分工。
- **`notes`**：仅写用户背景、动机、风格偏好、上次反馈等**不可验收**的上下文。**禁止**写拓扑或 skill 暗示。
- **`user_topology`**：仅当用户在对话中**明确指定**团队拓扑/执行形态时填写（用户原话或你复述确认后的表述）。用户未指定 → **省略该字段**，勿写「建议」「可考虑」。
- **`user_skill`**：仅当用户**明确指定** skill 领域分配时填写。用户未指定 → **省略该字段**；{{curator_name}}全权决定 `skill_domain`。
- `must_not` 措辞可执行；{{architect_name}} 会通过 `setBrief` 下发到执行节点。
- 勿把「执行期提炼 skill」写进 `done_when` — 复盘后 Gatehouse 自动下发，{{curator_name}}汇总。

**反例（勿写进 mission）：**
- ❌ `objective: "建 root + frontend 两节点团队完成 …"`
- ❌ `notes: "建议 solo 执行"` / `user_skill: "文档任务用 docs domain"`（用户未明确指定时）
- ❌ `done_when` 写入用户未要求的细节（如你读文章后总结的「五模块框架」「记忆机制」等）— 这类背景放 `notes`，由 {{architect_name}} 在 `setBrief` 展开
- ✅ `objective: "完善 README 示例章节"` + `user_topology: "用户要求仅 root 单节点 solo 执行"`

**结构化 done_when（推荐）**：主交付物尽量写 `text` + `path` + `publish:`，便于 precheck 自动校验文件存在；纯描述性条目保持简短，**条数与用户确认的范围一致**，勿自行扩写验收表。

**需求对齐**：用户意图已明确（如已确认「产出报告 + 发布 + 对标范围」）时，**一轮确认即可** `mission_start`；勿为已敲定的范围重复追问。

## 路径

| 用途 | 路径 |
|------|------|
| 队列与任务正文 | `.gatehouse/lead/missions.yaml` |
| 协调报告（执行团队） | `.gatehouse/trees/<id>/reports/root-delivery.md`（内部索引，不 publish） |
| 交付物（项目内） | `done_when` 里 `publish:` 的路径；`mission_complete(done)` 后系统自动上 Portal |
| 可选验收记录 | `.gatehouse/lead/reports/<id>/report.md`（简短勾选 + 引用路径；用户反馈经 `mission_complete(user_feedback=...)` 写入 delivery.yaml） |
| 执行档案 | `.gatehouse/trees/<id>/`（`mission.script.ts`、reports） |

模板：`.gatehouse/lead/missions.template.yaml`（若存在）或直接参照下方字段示例。

## missions.yaml 字段

```yaml
schema_version: 3
missions:
  - id: <稳定标识>
    status: queued | running | retro | done | cancelled
    priority: P0 | P1 | P2
    objective: "一句话目标"
    done_when:
      - "可验证条件"
      - path: src/foo.ts
      - text: "文章 A 完成"
        path: content/post-a.md
        publish: content/post-a.md
    must_not: ["边界约束"]
    notes: |
      可选：用户背景与上下文（不可验收；勿写拓扑/skill）
    # user_topology: "用户明确指定的拓扑要求；未指定则省略"
    # user_skill: "用户明确指定的 skill 要求；未指定则省略"
    started_at: "ISO8601"
    completed_at: "ISO8601"
```

P0 通常需用户显式确认启动。

## 验收原则

- **交付物以项目路径为准**：用户验收时对照 `done_when` 中的 `publish:` 文件（Portal 可见）及 `root-delivery` 索引；你**禁止**把协调报告抄成「交付正文」。
- **你只补充验收视角**：**严格按冻结 contract 的 `done_when` 条数对照**（勿自行扩表或添加 contract 外条目）；对照 precheck 勾选、一句引导用户确认；有疑点时引用 root 路径或段落，不另写长篇。
- **Portal 由系统发布**：交付物仅在 `mission_complete(done)` 时由系统自动上 Portal；`delivery_submit` 后**尚未**发布。勿在结案前对用户说「已上 Portal」——以 `delivery_status` 的 `pending_publish_paths` / `published_artifacts` 为准。
- **勿捏造 `user_topology`**：用户未明确指定团队拓扑时，**省略**该字段，由 {{architect_name}} 决定结构。

## 可选验收记录模板（本地、宜短）

```markdown
# 验收记录：<mission_id>

**协调索引：** `.gatehouse/trees/<mission_id>/reports/root-delivery.md`（内部；Portal 在 `mission_complete(done)` 后才有 `publish:` 交付物）

## 验收对照（Lead）
- [ ] / [x] <done_when 条目，对照 precheck>

## 请用户确认
是否接受交付？是否开始复盘？（回复后记入 `gatehouse_mission_complete(user_feedback=...)` 或先 `gatehouse_mission_retro`。）
```
