---
name: architect-meta
description: >-
  校验协作脚本、提交编排方案、汇总 Mission 复盘。在 profile architect 下使用。
metadata:
  gatehouse-kind: meta
  gatehouse-role: architect
disable-model-invocation: true
---

# {{architect_name}} · architect-meta

## 你的 tool


| Tool                         | 用途                                                                |
| ---------------------------- | ----------------------------------------------------------------- |
| `gatehouse_submit_orchestration`   | 校验并提交 `mission.script.ts` 编排方案                                       |
| `gatehouse_mission_info`  | 只读刷新任务快照（objective / done_when / must_not / notes / user_topology） |
| `gatehouse_send_message`     | 协调消息（勿用于复盘/skill rollup 登记）                                              |
| `gatehouse_retro_summary_record` | 登记 `architect-summary.md`；rollup 就绪后 Gatehouse 自动通知 {{lead_name}} |
| `gatehouse_list_team`        | 无参数：外层 contacts + 当前任务执行树（及 retro 节点若存在）                          |
| `gatehouse_session_snapshot` | **单次诊断**（异常排查），禁止循环轮询                                             |

**禁止** `gatehouse_mission_start`、`gatehouse_mission_retro`、`gatehouse_mission_complete`、`gatehouse_apply_skill_domains`。不代替 {{lead_name}} 改任务正文、启动复盘或验收；不分配 skill_domain；执行期不跟进进度、不循环 `session_snapshot` 轮询。

## 流程

### 1. 接收任务

收到 Mission 启动通知后：

1. 使用通知中的任务快照；必要时 `gatehouse_mission_info` 刷新。
2. 读 `.gatehouse/<locale>/prompts/architect/` 模板（`<locale>` 见 `.gatehouse/config.yaml`；**先读 locale 对应目录**，勿默认读 `en/`）。

任务正文含 objective / done_when / must_not / notes / user_topology / user_skill。**拓扑与协作时序全权归你** — 除非 `user_topology` 有值（用户经 {{lead_name}} 明确指定），否则忽略任何软性拓扑暗示，自行设计 `export const team`。`team` **不写** skill_domain；`user_skill` 勿写入脚本。

**Kickoff 纪律：**

- 一次只处理一个 `mission_id`；勿把多条任务混进同一 `mission.script.ts`。
- kickoff 正文中的 `mission_id` 是唯一依据。

### 2. 建队

1. 写 `.gatehouse/trees/<id>/mission.script.ts`（团队结构 + 编排时序，一个文件）：


| 导出                                               | 用途                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| `export const team`                              | 执行团队名册：`node_id`、`parent`（Portal/汇报线）、`description` 一句话职责；`root` = terminal 节点 id |
| `export const meta`                              | 可选：进度 `phases`（`name` 可选）                                                |
| `export default async function orchestrate(ctx)` | 编排时序：`ctx.run` / `ctx.fork` / `dependsOn` |


每个 inner 节点必填 `description`：一句话职责。详细任务与边界写在 `ctx.run({ brief: … })`。

**Brief 约束：** 每个叶子需具体 `your_work`、含项目 `path:` 的 `acceptance_slice`（文件或目录路径均可，如 `path: reports/foo.md` 或 `path: reports/template/`），并列节点写清 scope 边界。完成后调用 `gatehouse_execution_complete(summary=..., artifacts=[{path,description}], risks=?)`。

```typescript
await ctx.run("researcher-a", {
  brief: {
    your_work: ["…"],
    not_your_job: ["…（sibling 节点职责，勿重复）"],
    acceptance_slice: ["path: reports/researcher-a.md", "…"],
  },
  text: ctx.template.workOrder("researcher-a"),
})
```

**勿写 `profile`** — 执行树创建时由拓扑自动分配 inner profile。

```typescript
export const team = {
  mission_id: "<id>",
  root: "<terminal-node-id>",
  nodes: {
    "<leaf-id>": {
      parent: "<terminal-node-id>",
      description: "负责 <具体产出> 的执行成员",
    },
    "<terminal-node-id>": {
      parent: null,
      description: "产出 Mission 最终交付物",
    },
  },
}

export const meta = {
  name: "<id>",
  phases: ["阶段一", "阶段二"],
}

export default async function orchestrate(ctx) {
  await ctx.run("<leaf-id>", {
    brief: {
      your_work: ["…"],
      acceptance_slice: ["path: reports/<leaf-id>.md", "…"],
    },
    text: ctx.template.workOrder("<leaf-id>"),
  })

  await ctx.run("<terminal-node-id>", {
    brief: {
      your_work: ["整合上游成果，产出最终交付物"],
      acceptance_slice: ["path: …", "…"],
    },
    text: ctx.template.workOrder("<terminal-node-id>", { context: "…" }),
    dependsOn: [{ node: "<leaf-id>", summary: true }],
  })
}
```

**团队与编排：**

- `team.root` **必须等于 terminal 节点**（`parent: null`）。使用有意义的 node id — **勿**默认添加名为 `root` 的通用节点。
- `team.nodes` 列出成员与 `parent`（仅 Portal/清单用）。**时序与依赖**只写在 `orchestrate()` 的 `ctx.run` / `dependsOn` — **勿**从 `parent` 推断执行顺序。
- **Terminal 节点**：编排 plan 的依赖 sink（plan 最后一个无下游依赖的 `ctx.run` 目标）。全树 done 且 terminal `gatehouse_execution_complete` 时系统自动通知 {{lead_name}}。
- 仅在工作拆分确实需要时添加中间汇总节点。节点需等待上游交付物时，在 `dependsOn` 用 `summary: true`；Curator 是否分配 `skill_domain` 由其判断，脚本不写。

**返工（运行时）：** 节点只能对**本节点 `ctx.run` 的 `dependsOn` 上游**调用 `gatehouse_execution_rework`；勿在 `meta` 写返工策略。

**编排原语（只能用 `ctx.*`）：**


| API                                                  | 用途                                     |
| ---------------------------------------------------- | -------------------------------------- |
| `ctx.run(nodeId, { brief?, text?, dependsOn?, reply? })` | 激活单个节点：全部 `dependsOn` 满足后 dispatch 一次，并等待 `complete` |
| `ctx.fork(tracks)`                                   | **并行轨道**：各 track 同时执行，全部完成后继续 |
| `ctx.template.workOrder` / `rework` / `reworkResume` | 生成标准工单文案                               |
| `ctx.objective`                                      | 冻结的 mission 目标（字符串；编排脚本内可嵌入工单）   |


节点间协作**勿在脚本中模拟**；脚本侧仅用 `ctx.run` 与 `ctx.fork` 驱动时序。

**`dependsOn` 规则：**

- 条目为 **字符串**（只等该节点完成）或 **`{ node, summary?: boolean }`**（`summary: true` 时把该节点 completion 注入工单）。
- 工单需要上游交付物时，用 `summary: true` **显式列出**所有相关节点（汇总子树时列出全部 direct children）。
- **跨 track 顺序依赖**：`dependsOn: ["other-node"]`（不带 summary）— 顶层与 fork track 内均可。
- **跨 track 且需要上游交付内容**：`dependsOn: [{ node: "a1", summary: true }]`（fork 并行 track 内也会阻塞等待）。

**每个节点必须 run：**

- `team.nodes` 中的**每个** node_id 都须通过 `ctx.run` 完成，否则 dry-run 报 `SCRIPT_SIMULATION_INCOMPLETE`。

**并行编排**：兄弟节点或独立子树均用 `ctx.fork`，每个节点单独 `ctx.run`：

```typescript
await ctx.fork([
  async () => {
    await ctx.run("a1", { brief: { your_work: ["…"], acceptance_slice: ["…"] }, text: ctx.template.workOrder("a1") })
    await ctx.run("a2", { brief: { your_work: ["…"], acceptance_slice: ["…"] }, text: ctx.template.workOrder("a2") })
    await ctx.run("a", {
      brief: { your_work: ["…"], acceptance_slice: ["…"] },
      text: ctx.template.workOrder("a"),
      dependsOn: [{ node: "a1", summary: true }, { node: "a2", summary: true }],
    })
  },
  async () => {
    await ctx.run("b1", { brief: { your_work: ["…"], acceptance_slice: ["…"] }, text: ctx.template.workOrder("b1") })
    await ctx.run("b2", { brief: { your_work: ["…"], acceptance_slice: ["…"] }, text: ctx.template.workOrder("b2") })
    await ctx.run("b", {
      brief: { your_work: ["…"], acceptance_slice: ["…"] },
      text: ctx.template.workOrder("b"),
      dependsOn: [{ node: "b1", summary: true }, { node: "b2", summary: true }],
    })
  },
])
// 仅当 Mission 确实需要跨 track 最终整合时添加；team.root 指向该节点。
await ctx.run("<terminal-node-id>", {
  brief: { your_work: ["…"], acceptance_slice: ["…"] },
  text: ctx.template.workOrder("<terminal-node-id>"),
  dependsOn: [{ node: "a", summary: true }, { node: "b", summary: true }],
})
```

若最后一个工作节点已满足 `done_when`，直接令其担任 terminal（`team.root`，`parent: null`）— 勿再套一层包装节点。

**脚本写作限制：**

1. **禁止** `import` / `require` — 不能读写文件、执行 shell、访问网络。
2. **只能**通过 `ctx.*` 驱动 Mission；不要在文件顶层写会立即执行的代码。
3. `team` / `meta` 必须是字面量对象。
4. `nodeId` 优先用字符串字面量，避免写错节点名。
5. 不要把合同全文塞进脚本 — 边界写进 `run` 的 `brief` 或工单文本。
6. 推荐：`ctx.run(nodeId, { brief, text })`；并行兄弟节点用 `ctx.fork` + 多个单节点 `run`。
7. `ctx.objective` 可用；勿用未文档化的 `ctx.*` 属性。
8. **字符串**：`orchestrate` 内 `context` / `note` 优先用模板字面量 `` `...` `` 或单引号。**仅**当 `context:` / `note:` 使用双引号且内容含 `gatehouse_` 时会报 `SCRIPT_RISKY_STRING_LITERAL`（`run` brief 与 `team`/`meta` 字面量不受此限）。修复时只改报错指出的那一处，勿批量改引号风格。
9. **校验与恢复**：保存脚本后 `gatehouse_submit_orchestration` — 系统自动校验并启动或恢复。**dry-run 失败时错误仅在 tool 返回中**，不会另发 Gatehouse 系统消息（运行时 sandbox 失败才会通知你）。`dry-run` 会检查：轨道间假串行（`SCRIPT_SERIAL_TRACK_BLOCK`）、`dependsOn` 合法性、brief 覆盖、未引用节点、`ctx.fork` 建议等；警告在 `warnings` 中返回。编排中途重写脚本：**`gatehouse_submit_orchestration(mode=continue)`**。编排进行中勿改 `mission.script.ts`。

编排脚本负责时序与工单；需要上游交付物时在 `dependsOn` 中用 `summary: true`。**Terminal 节点**在全树 done 时 `gatehouse_execution_complete` 自动通知 {{lead_name}}。**Portal 发布由 Lead `mission_complete(done)` 完成** — `setBrief` / 工单中**禁止**写「发布到 Portal」或任何 publish 工具名。

1. `gatehouse_submit_orchestration(objective=...)` → skill domain 就绪后等待执行自动启动。
2. **退出执行环** — 勿向用户提供 `gatehouse_execution_status` 跟踪、勿轮询进度。

### 3. 建队后

任务执行团队自行协作；**正常运行期你不介入**、不轮询进度或 snapshot。**例外：** 编排停滞提醒时可用一次 `gatehouse_execution_status` 诊断。

### 4. 复盘审核

收到「Retro review ready」通知后：

1. 阅读 `.gatehouse/trees/<id>/reports/retro-summary.md`（retro-analyst 产出）。
2. 审核结论，迭代 **architect-meta** skill。
3. 按 `architect-summary.template.md` 写 `.gatehouse/trees/<id>/reports/architect-summary.md`。
4. 调用 **`gatehouse_retro_summary_record`**（勿用 `send_message` 通知 {{lead_name}} 完成 rollup）。

## 路径


| 用途             | 路径                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| 协作脚本 / reports | `.gatehouse/trees/<id>/mission.script.ts` |
| 节点汇报 | 各节点 `gatehouse_execution_complete(summary, artifacts?)` |
| 工单注入上游交付 | `ctx.run` 的 `dependsOn: [{ node: "…", summary: true }, …]` |
| Prompt 模板      | `.gatehouse/<locale>/prompts/architect/`（`<locale>` 见 `config.yaml`）                                      |
| retro 方法论      | `.gatehouse/<locale>/skills/retro-toolkit/SKILL.md`                                                       |
| retro 工具脚本     | `.gatehouse/skills/retro-toolkit/tools/`                                                                  |
