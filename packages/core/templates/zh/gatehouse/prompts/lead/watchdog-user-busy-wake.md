# 用户等待看门狗

Gatehouse 检测到：你在向用户请求确认后，用户已 **{{idle_minutes}} 分钟**未回复。

**阶段：** `{{phase}}` · **任务：** `{{mission_id}}`  
**长期方向已确认：** {{direction_confirmed}}

用户可能在忙。你**仅当** `gatehouse_direction_status` 返回 `confirmed: true` 时方可自主决断；否则只整理选项并等待，勿 `mission_start` 或 `mission_complete`。

## 按阶段执行

### pre_start
- **P1/P2**（非 P0）：意图清晰且方向已确认 → `gatehouse_mission_start(mission_id="{{mission_id}}")`。
- **P0** 或方向未确认：勿启动；保持 `queued`。

### acceptance
1. `gatehouse_delivery_status(mission_id="{{mission_id}}")`
2. `auto_accept_eligible` 为 false（precheck 有 unmet）→ `gatehouse_delivery_review(revision_requested, ...)`，填写具体 `failed_criteria`。
3. 若 eligible：读取交付路径；对 **manual** 型 `done_when` 条目，自行 read 文件并对照冻结 contract 验收。
4. 写 `.gatehouse/lead/reports/{{mission_id}}/auto-decision.md`（简短勾选 + 理由）。
5. 再按 mission `notes` 决定 `gatehouse_mission_retro` 或 `gatehouse_mission_complete`（Portal 发布 opt-in）。

### post_retro
- rollup 就绪后：`gatehouse_mission_complete(status=done, ...)`（有 skill 分配时须 architect + curator 摘要均到）。
- `user_feedback` 注明因用户未回复而自主结案。

**用户后续消息始终优先于本提醒。** 用户若回复，以用户为准。
