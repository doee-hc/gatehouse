# Mission 协作脚本编排方案

> Gatehouse mission 执行编排的设计稿：废弃 `execution-plan.yaml`，将 `teamspec` 并入协作脚本，统一 `ctx.prompt` 投递原语，保留 `gatehouse_execution_rework` 并与脚本 `waitFor` 兼容。

---

## 1. 目标与原则


| 原则            | 说明                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| **一处真源**      | 团队结构 + 协作时序 + 系统向 agent 的投递，集中在 **mission 协作脚本**；废弃 `execution-plan.yaml`；`teamspec.yaml` deprecated |
| **DB 存、工具读**  | contract / brief / 编排状态在 `registry.db`；执行 agent 用 `**gatehouse_*` 工具读**，不全文塞进 session                |
| **编排器只发系统消息** | 脚本 **不模拟** peer `A send to B`；节点互聊走 `**gatehouse_send_message`**                                     |
| **完成靠显式信号**   | `waitFor` 等 `**gatehouse_execution_complete`**；**不靠** session idle                                   |
| **动态编排**      | 循环、分支、A↔B 多轮、root 放行后继续参与，用 **脚本** 表达，不用静态 `depends_on` DAG                                          |
| **返工事件化**     | `gatehouse_execution_rework` 保留；由 orchestrator 事件处理 + `prompt(reply:true)`，脚本默认无感                    |


---

## 2. 产物与文件布局

```
.gatehouse/
  lead/missions.yaml              # Lead 立项（不变）
  trees/<mission_id>/
    mission.script.ts             # 【新】团队结构 + 编排逻辑（authoring 真源）
    reports/…                     # 交付报告（不变）
    # 废弃 / 不再新建：
    # teamspec.yaml
    # execution-plan.yaml
    # node-briefs/*.yaml          # 可选：仅作模板；运行时以 DB 为准
  registry.db                     # runtime 真源
  internal/exports/…              # 人类调试 export（可选）
```

**Bootstrap 流程：**

```text
mission_start → freeze contract → registry
Architect 写 mission.script.ts
gatehouse_bootstrap_tree
  → parse team 区 → 校验 → 建 N 个 session
  → import brief 初始切片（若有）→ DB
  → 注册 orchestrator，执行脚本（或执行到第一个 wait）
curator apply_skill_domains（skill_domain 写入 manifest，流程可不变）
```

---

## 3. 协作脚本结构

```typescript
// .gatehouse/trees/<mission_id>/mission.script.ts

/** ── 静态区：原 teamspec ── */
export const team = {
  mission_id: "stress-chat-32",
  root: "stress-root",
  nodes: {
    "stress-root": {
      parent: null,
      description: "总协调",
    },
    "zone-a": { parent: "stress-root", description: "A 区" },
  },
} as const;

/** ── 元信息（进度 UI / 人类可读 / rework 策略）── */
export const meta = {
  name: "chat-stress-32",
  phases: ["Bootstrap", "Zone release", "Chat waves", "Rollup"],
  rework: {
    peer_allowed: true,
    escalate_to: "root" as const,
    allow_coordinator_rework: true,
  },
};

/** ── 编排区 ── */
export default async function orchestrate(ctx: MissionContext) {
  // Architect 自由编写
}
```

- `**team**`：谁存在、`parent` 汇报树、`description`（一句话职责）
- `**meta**`：进度展示、`rework` 策略（替代原 `execution-plan.rework_policy`）
- `**orchestrate**`：时序、循环、条件、`prompt` / `setBrief` / `waitFor`

**profile 推断：** 不写 `profile`；bootstrap 按拓扑推 `build-root` / `build-coordinator` / `build`。

---

## 4. 编排原语 API

### 4.1 唯一投递原语：`ctx.prompt`

```typescript
await ctx.prompt(nodeId: string | string[], input: {
  text?: string;
  system?: string;
  reply?: boolean;  // 默认 false
});
```


| `reply`         | 行为                                                                               |
| --------------- | -------------------------------------------------------------------------------- |
| `**false`（默认）** | `noReply` 注入 system/text；**不触发** agent 一轮；**不**标 `running`                       |
| `**true`**      | 投递 user 层消息并 **触发一轮对话**；**自动** `pending → running`（或 `done → running` 进入新 round） |


**约定：**

- `**reply: true` 自动等价于 markRunning**；无独立 `activate` / `markRunning` / `send`
- 编排器发送方恒为 **Gatehouse runtime**；peer 消息仅 agent `gatehouse_send_message`
- 实现路径：`deliverSystemPrompt` → `promptSession`；可用 `buildDirectedNotification("Gatehouse", …)` 包装

### 4.2 写 DB：`ctx.setBrief`

```typescript
await ctx.setBrief(nodeId, partial: {
  your_work?: string[];
  not_your_job?: string[];
  acceptance_slice?: string[];
  role?: string;
});
```

- 只写 `registry_node_brief`；agent 用 `**gatehouse_node_brief**` 读
- 通常在 `prompt(..., reply: true)` **之前**调用，表示当轮任务书
- 不提供「把 brief 当 prompt 发给 agent」的 API

### 4.3 脚本侧读 registry（拼文案用）

```typescript
ctx.readMissionContext(): string;
ctx.readContract(opts?: { view: "summary" | "full" }): unknown;
```

- 供 Architect 在 `prompt.text` 里选择性引用
- 不替代 agent 工具；执行节点仍以 `gatehouse_mission_context` / `gatehouse_mission_contract` 为真源

### 4.4 等待与完成

```typescript
await ctx.waitFor(nodeId, "complete", opts?: { timeout?: string });
await ctx.waitForAll(nodeIds, "complete", opts?);
await ctx.waitForRollup(rootNodeId);  // 可选：沿 team.parent 等子树 delivery 索引
```

- `**complete**` = agent 调用 `**gatehouse_execution_complete**`
- 仅 `**running` / `rework**` 可 complete；`blocked` 不可
- `**blocked` 不算 complete**（rework 兼容关键）
- orchestrator 事件驱动：满足 wait 条件后 resume 脚本 continuation

### 4.5 模板糖（非独立原语）

```typescript
ctx.template.workOrder(opts?): string;
ctx.template.rework({ requester, reason, evidence? }): string;
ctx.template.reworkResume({ blocker, reason? }): string;
ctx.phase(title: string): void;
ctx.log(msg: string): void;
ctx.nodeIds() / ctx.leaves() / ctx.children(nodeId): string[];
```

**不提供：** `ctx.send`、`ctx.activate`、`depends_on`、静态 plan。

---

## 5. 编排状态机

表：`registry_orchestration_state`（或重构现有 execution state，去掉 `depends_on`）

```typescript
type OrchestrationNodeState = {
  status: "pending" | "running" | "done" | "blocked" | "rework";
  round?: number;
  blocked_by?: string;
  rework_reason?: string;
  waiting_requesters?: string[];
  activated_at?: string;
  completed_at?: string;
};
```


| 状态        | 含义                                             |
| --------- | ---------------------------------------------- |
| `pending` | 尚未收到本阶段 `reply: true` 的 prompt                 |
| `running` | 已 prompt 开工，等 complete                         |
| `done`    | 本阶段已 complete                                  |
| `blocked` | requester 已开 rework，等 `blocked_by` 再次 complete |
| `rework`  | 被返工方，需再次 complete                              |


**多轮：** 脚本可 `setBrief` + `prompt(reply:true)` 使 `done → running`（`round++`）。**不由 `depends_on` 自动解锁**；解锁完全由脚本顺序 + `waitFor` 决定。

**与 OpenCode session：** `busy/idle` 仅影响 `registry_pending_delivery` flush，**不作为** `waitFor` 条件。

---

## 6. `gatehouse_execution_rework`（与脚本调度兼容）

### 6.1 保留语义

```text
请求方 B 发现依赖方 A 产出不合格
  → A: done|running → rework（收到返工 prompt, reply:true）
  → B: running → blocked（blocked_by=A）
  → A 再次 execution_complete → done
  → B: blocked → running（收到 reworkResume prompt, reply:true）
  → B 再次 complete 后，waitFor 才认为 B 本阶段完成
```

### 6.2 策略：`meta.rework`

```typescript
export const meta = {
  rework: {
    peer_allowed: true,              // 默认同 mission inner 可互开
    escalate_to: "root" | "parent",  // peer_allowed=false 时的升级路径
    allow_coordinator_rework: true,  // root/coord 对下属开 rework
  },
};
```

`**blocked_by` 校验：**


| 规则                           | 说明                                                           |
| ---------------------------- | ------------------------------------------------------------ |
| 两节点均在 `team.nodes`           | 否则 `UNKNOWN_BLOCKER`                                         |
| 请求方须 `**running`**           | 已开工、本阶段未 complete                                            |
| 被返工方须 `**done` 或 `running**` | 常见：A 已交工但 B 验收不过                                             |
| **关系**（满足其一）                 | `team.parent[requester] === blocker`；或同 `waitForAll` 批次；或白名单 |
| `**peer_allowed: false`**    | 仅允许 `blocked_by` 为 requester 祖先链或 root                       |


### 6.3 事件流（orchestrator 处理，脚本无感）

**B 调用 `gatehouse_execution_rework`：**

1. 校验 `meta.rework` + team 关系
2. `A → rework`，`B → blocked`
3. `ctx.prompt(A, { text: template.rework(...), reply: true })`
4. 若脚本在 `await waitForAll(...)`：`blocked` / `rework` 均不满足 complete

**A 再次 `gatehouse_execution_complete`：**

1. `A → done`
2. 扫描 `blocked_by === A` 的节点 → `blocked → running`
3. `ctx.prompt(B, { text: template.reworkResume(...), reply: true })`
4. 继续等 B 再次 complete

### 6.4 边界


| 场景                      | 处理                                                    |
| ----------------------- | ----------------------------------------------------- |
| B 已 `done` 后想返工 A       | **不支持** rework；用 `send_message` 或脚本新 phase + `prompt` |
| 多方等同一 A                 | A complete 后批量解冻 + prompt                             |
| 无 orchestration runtime | 工具返回 `no_orchestration`（非 `no_plan`）                  |


### 6.5 complete / rework 矩阵


| 状态        | `complete`              | `rework`（作 requester） |
| --------- | ----------------------- | --------------------- |
| `running` | ✅ → `done`              | ✅ → 自己 `blocked`      |
| `rework`  | ✅ → `done`，解冻 requester | —                     |
| `blocked` | ❌                       | ❌                     |
| `done`    | ❌（除非脚本新 round）          | ❌                     |
| `pending` | ❌                       | ❌                     |


---

## 7. Agent 工具


| 工具                             | 角色                                            |
| ------------------------------ | --------------------------------------------- |
| `gatehouse_node_brief`         | 读 DB 当轮 brief                                 |
| `gatehouse_mission_context`    | 共享边界                                          |
| `gatehouse_mission_contract`   | 协调者/外层全文；叶子 summary                           |
| `gatehouse_execution_complete` | 向编排器声明本阶段完成                                   |
| `gatehouse_execution_rework`   | in-flight 返工（见 §6）                            |
| `gatehouse_execution_status`   | 读 orchestration state（含 blocked/rework/round） |
| `gatehouse_send_message`       | **peer 协调与聊天**                                |
| ~~`gatehouse_execution_plan`~~ | **废弃**（或改为 `gatehouse_orchestration_status`）  |


---

## 8. Bootstrap 与 session

```text
1. parse export const team → validate
2. 拓扑序 createSession + registry.syncInnerFromManifest
3. 对每个 node：
     bootstrap 注入节点角色 + mission context [+ 子树快照]；`setBrief` 同步任务书到 system
4. 启动 orchestrate(ctx)
5. flushPendingDeliveries
```

**Kickoff：** 不再依赖 `dispatch-root.md` 硬编码「逐节点 send_message 分派」；改为脚本内 `setBrief` + 对 root 的 `prompt(reply:true)`。

---

## 9. 废弃与迁移


| 废弃                                  | 替代                                  |
| ----------------------------------- | ----------------------------------- |
| `execution-plan.yaml`               | `orchestrate` + `waitFor`           |
| `depends_on` / `activateReadyNodes` | `prompt(reply:true)` + `waitFor`    |
| `execution-plan.rework_policy`      | `meta.rework`                       |
| `teamspec.yaml`                     | `export const team`                 |
| `node-briefs/*.yaml`（可选）            | `setBrief` + DB                     |
| `gatehouse_execution_plan`          | orchestration state + `meta.phases` |
| `activate` / `send`（编排 API）         | `prompt` + `reply`                  |


---

## 10. 示例：32 人聊天压测（片段）

```typescript
export default async function orchestrate(ctx) {
  ctx.phase("Release zones");

  for (const id of ["zone-a", "zone-b", "zone-c"]) {
    await ctx.setBrief(id, {
      your_work: ["等待本区 squad 汇总", "观察 5s 节流"],
    });
    await ctx.prompt(id, {
      text: ctx.template.workOrder({ note: "三区并行开工" }),
      reply: true,
    });
  }
  await ctx.waitForAll(["zone-a", "zone-b", "zone-c"], "complete");

  ctx.phase("Chat waves");
  for (let w = 1; w <= 3; w++) {
    for (const id of ctx.leaves()) {
      await ctx.setBrief(id, {
        your_work: [`第 ${w} 波：5s 间隔 3 条 send_message`],
      });
      await ctx.prompt(id, {
        text: ctx.template.workOrder({ wave: w }),
        reply: true,
      });
    }
    // 波次内可发生 rework；wait 自动等待直至全员 done
    await ctx.waitForAll(ctx.leaves(), "complete");
  }

  ctx.phase("Rollup");
  await ctx.waitForRollup(team.root);
  await ctx.prompt(team.root, {
    text: "写 root-delivery 并 gatehouse_delivery_submit",
    reply: true,
  });
  await ctx.waitFor(team.root, "complete");
}
```

---

## 11. 安全与实现


| 项    | 要求                                                                 |
| ---- | ------------------------------------------------------------------ |
| 脚本沙箱 | 仅 `ctx.*`；禁 `fs`/`shell`/`fetch`（或白名单）                             |
| 执行环境 | Bun/隔离 VM；脚本存 DB + authoring 文件                                    |
| 长跑   | orchestrator checkpoint in `registry.db`；complete/rework 事件 resume |
| 校验   | bootstrap 前 dry-run：parse `team`、静态 node_id                        |
| 投递   | busy → `registry_pending_delivery`                                 |


**建议模块：**

```text
packages/core/src/orchestration/
  state.ts
  events.ts       # onComplete, onRework
  prompt.ts       # 统一 prompt(reply)
  wait.ts         # waitFor / resume continuation
  rework.ts
  script-parse.ts # team + meta
```

---

## 12. 角色分工


| 角色            | 负责                                                                 |
| ------------- | ------------------------------------------------------------------ |
| **Lead**      | `missions.yaml`                                                    |
| **Architect** | `mission.script.ts`（`team` + `meta` + `orchestrate`）               |
| **Curator**   | `skill_domain`                                                     |
| **执行节点**      | `gatehouse_*` 读 brief/边界；`send_message` peer；`complete` / `rework` |


---

## 13. 与 Claude Code Workflow 边界


|      | Claude Workflow            | Gatehouse mission.script             |
| ---- | -------------------------- | ------------------------------------ |
| 执行体  | 临时 subagent                | 常驻 inner session                     |
| 投递   | `agent(prompt)`            | `ctx.prompt(..., reply)`             |
| 完成   | loop 结束 / StructuredOutput | `execution_complete`                 |
| 返工   | 脚本内重跑 `agent()`            | `execution_rework` 事件 + `waitFor` 拉长 |
| Peer | 拼进下一 agent prompt          | `gatehouse_send_message`             |


---

## 14. 实施阶段


| 阶段     | 内容                                                                                                    |
| ------ | ----------------------------------------------------------------------------------------------------- |
| **P0** | `MissionContext`；`prompt`/`setBrief`/`waitFor`；`team` 解析；orchestrator runtime；`onComplete`/`onRework` |
| **P1** | 废弃 plan 路径；迁移测试；bootstrap / permissions / README                                                      |
| **P2** | `template.*`、dry-run、`phase` UI、`waitForRollup`                                                       |
| **P3** | 删除 execution-plan 表/工具；architect-meta SKILL 切换                                                        |


---

## 15. Review 检查清单

- 废弃 `execution-plan.yaml`；时序由脚本 + `waitFor` 控制
- `teamspec` 并入 `export const team`
- 编排 API：`prompt` + `setBrief` + `waitFor` + 读 helper + `template.*`
- `reply: true` ⇒ 自动 `running`；无 `activate`/`send`/`markRunning`
- peer 聊天仅 `gatehouse_send_message`
- brief/contract：DB + agent 工具；`setBrief` 只写 DB
- 多轮：`done → running` + `round`，非 `depends_on`
- **保留 `gatehouse_execution_rework`**：`meta.rework` + 事件化 + `waitFor` 兼容
- `dispatch-root` 废弃或模板化程度

