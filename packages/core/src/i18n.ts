import type { GatehouseLocale } from "./locale.ts"

type MessageTable = Record<string, { zh: string; en: string }>

const messages = {
  "bulletList.empty": { zh: "（无）", en: "(none)" },
  "mission.objectiveMissing": { zh: "（mission 未提供 objective）", en: "(mission has no objective)" },
  "curator.objectiveFallback": { zh: "（mission 未提供 objective）", en: "(mission has no objective)" },
  "mission.status.ended": { zh: "已结束", en: "ended" },
  "mission.status.cancelled": { zh: "已取消", en: "cancelled" },
  "mission.started.body": {
    zh: `[Gatehouse · Mission 已启动 · {mission_id}]

{lead_name} 已通过 gatehouse_mission_start 启动本 Mission。

{mission_contract}

下一步：在 \`.gatehouse/missions/{mission_id}/\` 编写 **mission.script.ts**，完成后 **gatehouse_submit_orchestration**。若需刷新任务快照，可调用 **gatehouse_mission_info**。`,
    en: `[Gatehouse · Mission started · {mission_id}]

{lead_name} started this Mission via gatehouse_mission_start.

{mission_contract}

Next: write **mission.script.ts** under \`.gatehouse/missions/{mission_id}/\`, then **gatehouse_submit_orchestration**. Call **gatehouse_mission_info** to refresh the snapshot if needed.`,
  },
  "mission.started.fallback": {
    zh: `[Gatehouse · Mission 已启动 · {mission_id}]

{lead_name} 已通过 gatehouse_mission_start 启动本 Mission；任务快照未嵌入本通知，请调用 **gatehouse_mission_info** 查看。`,
    en: `[Gatehouse · Mission started · {mission_id}]

{lead_name} started this Mission via gatehouse_mission_start; mission snapshot not in this notification — call **gatehouse_mission_info**.`,
  },
  "mission.ended": {
    zh: `[Gatehouse · Mission {mission_id} {status_label}]

{lead_name} 已通过 gatehouse_mission_complete 结束本轮 Mission（missions.yaml → {status}）。Mission 执行团队相关 OpenCode session 已中止；请勿再分配任务、投递或等待本轮交付。`,
    en: `[Gatehouse · Mission {mission_id} {status_label}]

{lead_name} closed this Mission via gatehouse_mission_complete (missions.yaml → {status}). OpenCode sessions for the execution team have been stopped; do not assign work, deliver, or wait for this round.`,
  },
  "mission.ended.no_retro": {
    zh: `[Gatehouse · Mission {mission_id} {status_label} · 无复盘]

{lead_name} 已结束本轮 Mission（missions.yaml → {status}）。本轮未进行复盘；任务已结束，执行团队相关 OpenCode session 已中止。

这只是一个通知，你不需要有任何动作。`,
    en: `[Gatehouse · Mission {mission_id} {status_label} · no retro]

{lead_name} closed this Mission (missions.yaml → {status}). Retro was not conducted this round; the mission is ended and execution-team OpenCode sessions have been stopped.

This is a notification only — no action is required from you.`,
  },
  "orchestration.failed": {
    zh: `[Gatehouse · 编排脚本执行失败 · {mission_id}]

\`{script_path}\` 的 \`orchestrate()\` 函数体无法执行。

**错误：** {error}

**下一步：**
1. 修复 \`{script_path}\`（常见原因：双引号字符串内嵌未转义的 \`"\`；\`await ctx.*\` 步骤之间的 \`//\` 行注释会导致 plan-step 重放失败）
2. 保存后调用 **gatehouse_submit_orchestration(mode=continue)**（若已改脚本）或 **gatehouse_submit_orchestration**（submit，仅 resume 同一脚本时）

执行团队 session 已保留；仅编排未启动或已中断。`,
    en: `[Gatehouse · Orchestration script failed · {mission_id}]

The \`orchestrate()\` body in \`{script_path}\` could not run.

**Error:** {error}

**Next:**
1. Fix \`{script_path}\` (common causes: unescaped \`"\` inside double-quoted strings; \`//\` line comments between \`await ctx.*\` steps break plan-step replay)
2. Save, then call **gatehouse_submit_orchestration(mode=continue)** after rewriting the script, or **gatehouse_submit_orchestration** (submit) to resume the same script

Execution team sessions are kept; only orchestration failed to start or stalled.`,
  },
  "retro.reviewReady": {
    zh: `[Gatehouse 复盘待审 · Mission {mission_id}]

{architect_name} 助手已完成复盘分析并登记 \`{retro_summary_path}\`。

请阅读 retro-summary，审核结论并迭代 **architect-meta**；按 \`architect-summary.template.md\` 撰写 \`.gatehouse/missions/{mission_id}/reports/architect-summary.md\`，再调用 **gatehouse_retro_summary_record** 提交登记。`,
    en: `[Gatehouse · Retro review ready · Mission {mission_id}]

The retro analyst finished and registered \`{retro_summary_path}\`.

Read retro-summary, review conclusions, and iterate **architect-meta**; write \`.gatehouse/missions/{mission_id}/reports/architect-summary.md\` per \`architect-summary.template.md\`, then call **gatehouse_retro_summary_record** to register submission.`,
  },
  "retro.summaryReady": {
    zh: `[Gatehouse 复盘汇总就绪 · Mission {mission_id}]

本轮复盘摘要已全部登记（architect 复盘摘要{curator_suffix}）。请阅读：
- \`{architect_summary_path}\`
{curator_line}

**下一步：** 按你的判断结案 → \`gatehouse_mission_complete(done, publish_deliverables=...)\`（如需 Portal 发布）`,
    en: `[Gatehouse · Retro summaries ready · Mission {mission_id}]

Retro summaries are fully registered (architect summary{curator_suffix}). Read:
- \`{architect_summary_path}\`
{curator_line}

**Next:** Close out when ready → \`gatehouse_mission_complete(done, publish_deliverables=...)\` (when Portal publish is wanted)`,
  },
  "retro.summaryReady.curatorSuffix": {
    zh: "与 curator skill 摘要",
    en: " and curator skill summary",
  },
  "retro.summaryReady.curatorLine": {
    zh: "- `{curator_summary_path}`",
    en: "- `{curator_summary_path}`",
  },
  "curator.skillExtractBatchReady": {
    zh: `[Gatehouse 领域 skill 提炼与验证就绪 · Mission {mission_id}]

全部配置了 skill_domain 的节点已完成 extract + verify 并登记。请阅读各节点 \`-extract.md\` / \`-verify.md\` 摘要与 \`.gatehouse/skills/by-domain/\` 下变更，整理 domains 注册表、去重合并；若提炼质量有系统性问题，按 \`curator-meta\` 更新 \`.gatehouse/<locale>/prompts/architect/domain-skill-extract.md\`（保留全部 \`{{...}}\` 占位符）。完成后调用 **gatehouse_skill_summary_record** 提交 \`curator-summary.md\` 登记。

{lines}`,
    en: `[Gatehouse · Domain skill extract + verify ready · Mission {mission_id}]

All nodes with skill_domain finished extract + verify and registration. Review \`-extract.md\` / \`-verify.md\` summaries and changes under \`.gatehouse/skills/by-domain/\`, reconcile the domains registry, and dedupe; if extract quality shows recurring issues, update \`.gatehouse/<locale>/prompts/architect/domain-skill-extract.md\` per \`curator-meta\` (keep all \`{{...}}\` placeholders). When done, call **gatehouse_skill_summary_record** to register \`curator-summary.md\`.

{lines}`,
  },
  "skillDomain.existing.empty": {
    zh: "（本领域目录尚无已有 skill；仅根据本次亲历新建，勿为其它领域或未见步骤预建目录。）",
    en: "(No existing skills in this domain yet; create only from what you experienced—do not pre-create dirs for other domains or unseen steps.)",
  },
  "skillDomain.existing.header": {
    zh: "## 本领域已有 skill（仅供参考）",
    en: "## Existing skills in this domain (reference only)",
  },
  "skillDomain.existing.intro": {
    zh: "以下 slug 位于 `{path}/` 且已有 `SKILL.md`；合并时 read 对应文件。**不要**据此批量 mkdir，勿为未亲历步骤或其它领域建目录：",
    en: "These slugs live under `{path}/` with `SKILL.md`; read each file when merging. **Do not** bulk mkdir from this list or create dirs for steps you did not run or other domains:",
  },
  "skillDomain.contextNote": {
    zh: [
      "---",
      "领域 `{skill_domain}` 的 skill 目录：`{skill_domain_path}`",
      "按任务语义检索的 top-k skill（catalog）：",
      "{skill_catalog}",
      "加载方式：`skill({ name: \"<name>\" })` 或 read 对应 `SKILL.md`；勿期望全文自动注入。",
      "Mission 执行期勿提炼 skill；{lead_name}验收且复盘启动后，Gatehouse 会单独下发提炼指引。",
    ].join("\n"),
    en: [
      "---",
      "Domain `{skill_domain}` skills live under `{skill_domain_path}`",
      "Task-relevant top-k skills (semantic retrieval):",
      "{skill_catalog}",
      "Load via `skill({ name: \"<name>\" })` or read the `SKILL.md`; do not expect full auto-injection.",
      "Do not extract skills during Mission execution; after {lead_name} accepts and retro starts, Gatehouse will send separate extraction guidance.",
    ].join("\n"),
  },
  "directedNotification": {
    zh: "[Gatehouse 消息 · 来自 {sender}]",
    en: "[Gatehouse message · from {sender}]",
  },
  "portal.architectBootstrapCuratorHint": {
    zh: "协作脚本已提交，请为执行节点分配 skill_domain",
    en: "Collaboration script submitted — please assign skill_domain to execution nodes",
  },
  "arbiter.caseHeader": { zh: "[Gatehouse 权限案卷]", en: "[Gatehouse permission case]" },
  "arbiter.requesterHeader": { zh: "请求方 registry:", en: "Requester registry:" },
  "arbiter.reviewHint": {
    zh: "请审查后调用 gatehouse_inspector_decide（含 reason）。默认保守，不确定则 reject。",
    en: "Review then call gatehouse_inspector_decide (with reason). Default conservative—reject when unsure.",
  },
  "doneWhen.fileExists": { zh: "文件存在: {path}", en: "File exists: {path}" },
  "execution.nodeBrief.header": {
    zh: "## 节点任务书（Node Brief · {node_id}）",
    en: "## Node brief ({node_id})",
  },
  "execution.nodeBrief.role": { zh: "**角色：** {role}", en: "**Role:** {role}" },
  "execution.nodeBrief.yourWorkHeader": {
    zh: "**你的职责（your_work）：**",
    en: "**Your work (your_work):**",
  },
  "execution.nodeBrief.notYourJobHeader": {
    zh: "**不是你的事（not_your_job）：**",
    en: "**Not your job (not_your_job):**",
  },
  "execution.nodeBrief.acceptanceSliceHeader": {
    zh: "**本节点验收切片（acceptance_slice）：**",
    en: "**Acceptance slice (acceptance_slice):**",
  },
  "execution.nodeBrief.priorityHint": {
    zh: "**行动依据：** 以上任务书；严格遵守，勿扩大范围。记不清时可调用 `gatehouse_mission_info` 重新查看。",
    en: "**How to work:** Follow the brief above strictly; do not expand scope. Call `gatehouse_mission_info` to re-read if needed.",
  },
  "execution.missionContext.header": {
    zh: "## Mission Context（共同边界）",
    en: "## Mission context (shared boundaries)",
  },
  "execution.missionContext.objective": {
    zh: "**目标：** {objective}",
    en: "**Objective:** {objective}",
  },
  "execution.missionContext.objectiveMissing": {
    zh: "（未提供）",
    en: "(not provided)",
  },
  "execution.missionContext.readonlyHint": {
    zh: "**共同边界：** 见上文；可随时调用 `gatehouse_mission_info` 重新查看。",
    en: "**Shared boundaries:** As above; call `gatehouse_mission_info` anytime to re-read.",
  },
  "execution.missionContext.actionHint": {
    zh: "按任务书中的职责项执行；验收以任务书中的验收切片为准，勿自行扩大范围。",
    en: "Work from the duties listed in your brief; accept only against your brief's acceptance slice — do not expand scope on your own.",
  },
  "execution.workOrder.contextHeader": { zh: "**上下文：**", en: "**Context:**" },
  "execution.workOrder.blockerDone": {
    zh: "**依赖节点 {blocker} 已再次完成。**",
    en: "**Dependency node {blocker} completed again.**",
  },
  "execution.workOrder.reworkReasonReview": {
    zh: "**返工原因（回顾）：** {reason}",
    en: "**Rework reason (for reference):** {reason}",
  },
  "sessionSnapshot.wait.likelyWorking": {
    zh: "对方仍在执行或队列中有待投递消息；请结束本轮并耐心等待回复，勿循环 gatehouse_send_message 或 gatehouse_session_snapshot。",
    en: "The target is still working or has queued deliveries; end this turn and wait for a reply — do not loop gatehouse_send_message or gatehouse_session_snapshot.",
  },
  "sessionSnapshot.wait.likelyIdle": {
    zh: "对方 session 为 idle 且尾部无 running 工具；若你刚分配任务，应先结束本轮等待其回复。确需跟进时 gatehouse_send_message 一次即可，勿循环 snapshot。",
    en: "Target session is idle with no running tools at the tail; if you just assigned work, end this turn and wait for their reply. Follow up with gatehouse_send_message once if needed — do not loop snapshot.",
  },
  "sessionSnapshot.wait.unknown": {
    zh: "无法判断活动状态；若处于正常等待期，结束本轮等待系统消息，勿循环 snapshot。",
    en: "Activity state is unclear; if you are in a normal wait period, end this turn and wait for system messages — do not loop snapshot.",
  },
  "sessionSnapshot.pollLimitGuidance": {
    zh: "你已连续对同一目标调用 gatehouse_session_snapshot 超过 3 次。请勿重复轮询对方 session；请立即结束本轮对话，等待系统通知后再继续。",
    en: "You called gatehouse_session_snapshot on the same target more than 3 times in a row. Stop polling that session; end this turn immediately and wait for a system notification before continuing.",
  },
  "dispatch.teamSnapshot.executionHeader": { zh: "### 执行团队", en: "### Execution team" },
  "dispatch.teamSnapshot.outerHeader": { zh: "### 外层联系人", en: "### Outer contacts" },
  "dispatch.teamSnapshot.you": { zh: "（你）", en: " (you)" },
  "dispatch.teamSnapshot.outerHint": {
    zh: "核心团队（建队已完成）；编排 plan 的 terminal 节点在全树 done 时 `gatehouse_execution_complete` 自动通知 lead",
    en: "Core team (team build complete); the orchestration plan terminal node auto-notifies lead on final gatehouse_execution_complete",
  },
  "dispatch.teamSnapshot.teamspecHeader": { zh: "### 执行团队节点", en: "### Execution team nodes" },
  "dispatch.teamSnapshot.acceptanceBranchHeader": {
    zh: "### 分支快照（启动参考）\n\n本节点在 `team` 中有下属节点；任务时序由编排脚本的 `dependsOn` 驱动，你不负责调度分支。若 brief 要求汇总验收，收到上游 completion 后按 brief 核对并 `gatehouse_execution_complete`。通知可能附带「上游节点交付」— 只引用路径，勿复述正文。",
    en: "### Branch snapshot (kickoff reference)\n\nThis node has child nodes in `team`; orchestration timing is driven by the mission script and `dependsOn` — you do not schedule the branch. When your brief requires aggregating upstream completions, verify them per brief, then call `gatehouse_execution_complete`. Upstream completions — paths only, do not copy bodies.",
  },
  "execution.nodeRole.header": {
    zh: "## 节点角色（Node Role · {node_id}）",
    en: "## Node role ({node_id})",
  },
  "execution.nodeRole.description": {
    zh: "**职责：** {description}",
    en: "**Role:** {description}",
  },
  "execution.nodeRole.briefHint": {
    zh: "**任务书：** 开工前会收到本节点的任务书；记不清时可调用 `gatehouse_mission_info` 查看。",
    en: "**Your brief:** You receive your node brief before work starts; call `gatehouse_mission_info` if you need to look it up again.",
  },
  "execution.workOrder.activateHeader": {
    zh: "[Gatehouse · 执行激活 · {node_id}]",
    en: "[Gatehouse · execution activate · {node_id}]",
  },
  "execution.workOrder.reworkHeader": {
    zh: "[Gatehouse · 修正请求 · {node_id}]",
    en: "[Gatehouse · correction request · {node_id}]",
  },
  "execution.workOrder.reworkBecause": {
    zh: "**修正要求（尽量具体：路径/行号/验收项）：** {reason}",
    en: "**Correction scope (be specific: path, lines, or acceptance item):** {reason}",
  },
  "execution.workOrder.reworkRequester": {
    zh: "**请求方：** {requester}",
    en: "**Requested by:** {requester}",
  },
  "execution.workOrder.evidence": { zh: "**证据路径：** {path}", en: "**Evidence path:** {path}" },
  "execution.workOrder.missionInfoRef": {
    zh: "**行动依据：** 你的任务书与本次开工通知；严格遵守，勿扩大范围。",
    en: "**How to work:** Your node brief and this activation message; follow them strictly and do not expand scope.",
  },
  "execution.workOrder.completeHint": {
    zh: "完成后调用 `gatehouse_execution_complete(summary=...)` — 产出在项目目录，summary 中写明做了什么、路径与未完成项。",
    en: "When done, call `gatehouse_execution_complete(summary=...)` — deliverables live in the project; describe work, paths, and open items in summary.",
  },
  "execution.workOrder.reworkHint": {
    zh: "你在 `dependsOn` 中声明的上游产出不合格（含小范围修正）且仍处于 running：`gatehouse_execution_rework(blocked_by=<上游 node_id>, reason=..., evidence_path=...)` — 仅可打回本节点 run 的 `dependsOn` 上游；reason 只写最小修改面。",
    en: "An upstream node listed in your run `dependsOn` is wrong (including a small fix) while you are still running: `gatehouse_execution_rework(blocked_by=<upstream node_id>, reason=..., evidence_path=...)` — only dependsOn upstream nodes; state the minimal change in reason.",
  },
  "execution.workOrder.reworkScopeHint": {
    zh: "仅按上述修正要求改动；无需重做无关部分。完成后 `gatehouse_execution_complete`。",
    en: "Change only what the correction scope requires; do not redo unrelated work. Then call `gatehouse_execution_complete`.",
  },
  "completion.summary.header": {
    zh: "## 上游节点交付",
    en: "## Referenced node completions",
  },
  "completion.summary.hint": {
    zh: "以下为上游节点汇报摘要；**勿**展开交付物正文，只引用路径与结论。",
    en: "Upstream completion summaries below; **do not** paste deliverable bodies — reference paths and conclusions only.",
  },
  "completion.summary.nodeHeader": { zh: "节点 {node_id}", en: "Node {node_id}" },
  "completion.summary.missing": {
    zh: "（无汇报摘要）",
    en: "(no completion summary)",
  },
  "completion.structured.header": {
    zh: "## 上游结构化输出",
    en: "## Referenced structured outputs",
  },
  "completion.structured.hint": {
    zh: "以下为上游节点的 validated JSON；下游可直接引用字段，无需解析 prose summary。",
    en: "Validated JSON from upstream nodes below; downstream work may reference fields directly without parsing prose summaries.",
  },
  "completion.structured.nodeHeader": { zh: "节点 {node_id} · structured_output", en: "Node {node_id} · structured_output" },
  "completion.structured.missing": {
    zh: "（无 structured_output）",
    en: "(no structured_output)",
  },
  "completion.artifacts.header": {
    zh: "## 上游验收路径",
    en: "## Referenced deliverable paths",
  },
  "completion.artifacts.hint": {
    zh: "以下为上游节点 `acceptance_slice` 中的项目路径（非 `.gatehouse/`）；**直接 read 这些路径**，勿从 summary 猜测位置。",
    en: "Project paths from upstream `acceptance_slice` entries (never under `.gatehouse/`); **read these paths directly** — do not infer locations from summaries alone.",
  },
  "completion.artifacts.nodeHeader": {
    zh: "节点 {node_id} · 路径",
    en: "Node {node_id} · paths",
  },
  "execution.workOrder.structuredCompletionHint": {
    zh: "**结构化完成：** 调用 `gatehouse_execution_complete` 时须传 `structured_output` 且符合下列 JSON Schema：\n\n```json\n{schema}\n```",
    en: "**Structured completion:** pass `structured_output` on `gatehouse_execution_complete` matching this JSON Schema:\n\n```json\n{schema}\n```",
  },
  "completion.terminalDelivery.title": { zh: "任务交付索引 · {mission_id}", en: "Mission delivery index · {mission_id}" },
  "completion.terminalDelivery.generated": {
    zh: "> 协调索引：列路径与摘要，供验收对照；交付正文在项目目录。",
    en: "> Coordination index: paths and summaries for acceptance review; deliverable bodies live in the project tree.",
  },
  "completion.terminalDelivery.terminalSummary": { zh: "本节点摘要", en: "This node summary" },
  "completion.terminalDelivery.upstreamSummaries": { zh: "上游节点汇报", en: "Upstream node summaries" },
  "mission.contract.header": { zh: "## 任务快照（冻结）", en: "## Mission snapshot (frozen)" },
  "mission.contract.missionId": { zh: "**任务 ID：** {mission_id}", en: "**Mission ID:** {mission_id}" },
  "mission.contract.objectiveHeader": { zh: "**目标：**", en: "**Objective:**" },
  "mission.contract.doneWhenHeader": { zh: "**验收条件（done_when）：**", en: "**Acceptance criteria (done_when):**" },
  "mission.contract.mustNotHeader": { zh: "**边界（must_not）：**", en: "**Boundaries (must_not):**" },
  "mission.contract.notesHeader": { zh: "**备注（notes）：**", en: "**Notes:**" },
  "mission.contract.userTopologyHeader": {
    zh: "**用户指定拓扑（user_topology）：**",
    en: "**User-specified topology (user_topology):**",
  },
  "mission.contract.userSkillHeader": {
    zh: "**用户指定 skill（user_skill）：**",
    en: "**User-specified skill (user_skill):**",
  },
  "domains.registry.header": { zh: "### 已登记 domain-id", en: "### Registered domain ids" },
  "domains.registry.empty": { zh: "（domains.yaml 尚无条目）", en: "(no entries in domains.yaml yet)" },
  "delivery.lead.doneWhenHeader": {
    zh: "## 验收条件（done_when，供对照）",
    en: "## Acceptance criteria (done_when) for review",
  },
  "delivery.lead.refreshHint": {
    zh: "（任务快照；可用 `gatehouse_mission_info` 刷新）",
    en: "(mission snapshot; call `gatehouse_mission_info` to refresh)",
  },
  "delivery.submit.leadHeader": {
    zh: "## 任务交付已提交 · {mission_id}",
    en: "## Delivery submitted · {mission_id}",
  },
  "delivery.submit.version": { zh: "**交付版本：** v{version}", en: "**Delivery version:** v{version}" },
  "delivery.submit.recordPath": {
    zh: "**结构化记录：** {record_path}",
    en: "**Structured record:** {record_path}",
  },
  "delivery.submit.summaryHeader": { zh: "**交付摘要：**", en: "**Summary:**" },
  "delivery.submit.aggregatedSummaryHeader": { zh: "**节点汇报汇总：**", en: "**Aggregated node summaries:**" },
  "delivery.submit.precheckHeader": { zh: "**自动预检（precheck）：**", en: "**Automated precheck:**" },
  "delivery.submit.pendingPublishHeader": {
    zh: "**待发布交付物（结案时 `publish_deliverables=true` 会上 Portal）：**",
    en: "**Deliverables pending Portal publish (use `publish_deliverables=true` on mission_complete):**",
  },
  "delivery.submit.pendingPublishEmptyWarning": {
    zh: "**注意：** `done_when` 中未识别到可发布的项目交付路径（`path_exists`）。请用 YAML `- path: reports/foo.html` 或字符串 `path: reports/foo.html` / `文件存在: reports/foo.html`，否则结案时无法发布到 Portal。",
    en: "**Warning:** no publishable project deliverable paths (`path_exists`) were recognized in done_when. Use YAML `- path: reports/foo.html` or strings `path: reports/foo.html` / `file exists: reports/foo.html`, or Portal publish on complete will publish nothing.",
  },
  "delivery.submit.forceReasonHeader": {
    zh: "**强制提交说明（precheck 未全通过）：**",
    en: "**Force submit reason (precheck not fully met):**",
  },
  "delivery.submit.portalHint": {
    zh: "以上汇总与 precheck 供验收对照；**不是** Portal 交付正文。用户确认接受后，调用 `gatehouse_mission_complete(done, publish_deliverables=true)` 发布 `done_when` 中的项目路径。",
    en: "The aggregated summaries and precheck above are for review — **not** Portal deliverable bodies. After the user confirms acceptance, call `gatehouse_mission_complete(done, publish_deliverables=true)` to publish project paths from done_when.",
  },
  "delivery.submit.reviewHint": {
    zh: "对照 precheck 与项目内交付路径后，在对话中请用户确认；若需上 Portal，结案时传 `publish_deliverables=true`。可选 `gatehouse_mission_retro`，再 `gatehouse_mission_complete(done)`。返工或拒绝时调用 `gatehouse_delivery_review(revision_requested | rejected)`。",
    en: "After checking precheck and project deliverable paths, confirm with the user in chat; pass `publish_deliverables=true` on complete when they want Portal publish. Optionally call `gatehouse_mission_retro`, then `gatehouse_mission_complete(done)`. For rework or rejection use `gatehouse_delivery_review(revision_requested | rejected)`.",
  },
  "delivery.revision.header": {
    zh: "# 交付返工 · 任务 {mission_id} · v{from_version} → v{to_version}",
    en: "# Delivery revision · Mission {mission_id} · v{from_version} → v{to_version}",
  },
  "delivery.revision.failedHeader": { zh: "## 未通过验收项", en: "## Failed acceptance criteria" },
  "delivery.revision.briefHeader": { zh: "## 返工目标", en: "## Revision goals" },
  "delivery.revision.userFeedbackHeader": { zh: "## 用户原话", en: "## User feedback" },
  "delivery.revision.mustNotHeader": { zh: "## 边界（must_not）", en: "## Boundaries (must_not)" },
  "delivery.revision.completeHint": {
    zh: "返工完成后再次调用 `gatehouse_execution_complete(summary=...)`；全树节点均 done 时系统自动通知 lead 验收。",
    en: "When rework is done, call `gatehouse_execution_complete(summary=...)` again; the system notifies lead automatically once all nodes are done.",
  },
  "retro.kickoff.contextHeader": { zh: "## Mission 复盘启动快照", en: "## Mission retro kickoff snapshot" },
  "retro.kickoff.mission": { zh: "**Mission：** `{mission_id}`", en: "**Mission:** `{mission_id}`" },
  "retro.kickoff.terminalNode": { zh: "**Terminal 节点：** `{terminal_node}`", en: "**Terminal node:** `{terminal_node}`" },
  "retro.kickoff.nodeCount": { zh: "**节点数：** {node_count}", en: "**Node count:** {node_count}" },
  "retro.kickoff.analysisOrderHeader": {
    zh: "**按编排脚本顺序分析（唯一规则）：**",
    en: "**Analyze in orchestration script order (sole rule):**",
  },
  "retro.kickoff.runStep": {
    zh: "{index}. `run` → 分析 `context/{node}/`（timeline.md + metrics.json；禁止通读 messages.json）",
    en: "{index}. `run` → analyze `context/{node}/` (timeline.md + metrics.json; do not read all of messages.json)",
  },
  "retro.kickoff.parallelStep": {
    zh: "{index}. `parallel` → 并行段按声明顺序分析：{nodes}",
    en: "{index}. `parallel` → parallel segment; analyze in declared order: {nodes}",
  },
  "retro.kickoff.noPlanSteps": {
    zh: "（编排 plan 不可用 — 按 context/index.json 节点列表顺序分析）",
    en: "(Orchestration plan unavailable — analyze nodes in context/index.json order)",
  },
  "retro.kickoff.contextPaths": {
    zh: "原始数据：`.gatehouse/missions/{mission_id}/context/`（messages / timeline / metrics / mission-metrics.json）。",
    en: "Raw data: `.gatehouse/missions/{mission_id}/context/` (messages / timeline / metrics / mission-metrics.json).",
  },
} satisfies MessageTable

export function gatehouseMessage(
  key: keyof typeof messages,
  locale: GatehouseLocale,
  vars: Record<string, string> = {},
) {
  let text = messages[key][locale]
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, value)
  }
  return text
}

const directedNotificationPatterns = [
  /^\[Gatehouse 消息 · 来自 (.+?)\]\n\n([\s\S]*)$/,
  /^\[Gatehouse message · from (.+?)\]\n\n([\s\S]*)$/i,
]

export function parseDirectedNotification(promptText: string) {
  for (const pattern of directedNotificationPatterns) {
    const match = promptText.match(pattern)
    if (match) return { senderLabel: match[1]!, text: match[2]!.trim() }
  }
  return undefined
}

export function buildDirectedNotification(senderLabel: string, content: string, locale: GatehouseLocale) {
  const prefix = gatehouseMessage("directedNotification", locale, { sender: senderLabel })
  return `${prefix}\n\n${content}`
}

export function isGatehouseDirectedMessage(text: string) {
  return text.includes("[Gatehouse 消息") || text.includes("[Gatehouse message")
}
