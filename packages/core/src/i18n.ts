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

下一步：在 \`.gatehouse/trees/{mission_id}/\` 编写 **mission.script.ts**，完成后 **gatehouse_bootstrap_tree**。若需刷新任务快照，可调用 **gatehouse_mission_info**。`,
    en: `[Gatehouse · Mission started · {mission_id}]

{lead_name} started this Mission via gatehouse_mission_start.

{mission_contract}

Next: write **mission.script.ts** under \`.gatehouse/trees/{mission_id}/\`, then **gatehouse_bootstrap_tree**. Call **gatehouse_mission_info** to refresh the snapshot if needed.`,
  },
  "mission.started.fallback": {
    zh: `[Gatehouse · Mission 已启动 · {mission_id}]

{lead_name} 已通过 gatehouse_mission_start 启动本 Mission；registry 快照暂不可用，请调用 **gatehouse_mission_info**。`,
    en: `[Gatehouse · Mission started · {mission_id}]

{lead_name} started this Mission via gatehouse_mission_start; registry snapshot unavailable — call **gatehouse_mission_info**.`,
  },
  "mission.ended": {
    zh: `[Gatehouse · Mission {mission_id} {status_label}]

{lead_name} 已通过 gatehouse_mission_complete 结束本轮 Mission（missions.yaml → {status}）。Mission 执行团队相关 OpenCode session 已中止；请勿再分配任务、投递或等待本轮交付。`,
    en: `[Gatehouse · Mission {mission_id} {status_label}]

{lead_name} closed this Mission via gatehouse_mission_complete (missions.yaml → {status}). OpenCode sessions for the execution team have been stopped; do not assign work, deliver, or wait for this round.`,
  },
  "orchestration.failed": {
    zh: `[Gatehouse · 编排脚本执行失败 · {mission_id}]

\`{script_path}\` 的 \`orchestrate()\` 函数体无法执行。

**错误：** {error}

**下一步：**
1. 修复 \`{script_path}\`（常见原因：双引号字符串内嵌未转义的 \`"\`；skill 文档里的 \`gatehouse_send_message(recipient="...", ...)\` 示例不能直接放进 JS 双引号字符串）
2. 保存后再次调用 **gatehouse_bootstrap_tree** 重启编排

执行树 session 已保留；仅编排未启动或已中断。`,
    en: `[Gatehouse · Orchestration script failed · {mission_id}]

The \`orchestrate()\` body in \`{script_path}\` could not run.

**Error:** {error}

**Next:**
1. Fix \`{script_path}\` (common cause: unescaped \`"\` inside double-quoted strings; do not paste \`gatehouse_send_message(recipient="...", ...)\` examples from skill docs verbatim into JS double-quoted strings)
2. Save, then call **gatehouse_bootstrap_tree** again to restart orchestration

Execution-tree sessions are kept; only orchestration failed to start or stalled.`,
  },
  "retro.batchReady": {
    zh: `[Gatehouse 复盘就绪 · Mission {mission_id}]

全部 manager 复盘节点已完成并登记。请阅读下列报告，撰写 \`.gatehouse/trees/{mission_id}/reports/architect-summary.md\`。

**必做：** 汇总各 retro 的「工具贡献」→ 整理 \`.gatehouse/skills/retro-toolkit/\`（promote 有效脚本、更新 SKILL、演进 retro 规范）→ 更新 architect-meta skill → \`gatehouse_send_message(recipient="lead", ...)\` 通知{lead_name}。

{lines}

按 retro-toolkit skill 流程使用 \`context/\` 落盘与自制脚本。`,
    en: `[Gatehouse · Retro ready · Mission {mission_id}]

All manager retro nodes are complete and recorded. Read the reports below and write \`.gatehouse/trees/{mission_id}/reports/architect-summary.md\`.

**Required:** Summarize each retro's tool contributions → curate \`.gatehouse/skills/retro-toolkit/\` (promote useful scripts, update SKILL, evolve retro norms) → update architect-meta skill → \`gatehouse_send_message(recipient="lead", ...)\` to notify {lead_name}.

{lines}

Use \`context/\` dumps and retro-toolkit scripts per the skill workflow.`,
  },
  "curator.skillExtractBatchReady": {
    zh: `[Gatehouse 领域 skill 提炼就绪 · Mission {mission_id}]

全部配置了 skill_domain 的执行节点已完成复盘期 skill 提炼并登记。请阅读各节点 session 摘要与 \`.gatehouse/skills/by-domain/\` 下变更，整理 domains 注册表、去重合并后 \`gatehouse_send_message(recipient="lead", ...)\` 通知{lead_name}（若需）。

{lines}`,
    en: `[Gatehouse · Domain skill extract ready · Mission {mission_id}]

All exec nodes with skill_domain finished retro skill extraction and registration. Review session summaries and changes under \`.gatehouse/skills/by-domain/\`, reconcile the domains registry, dedupe, then \`gatehouse_send_message(recipient="lead", ...)\` to notify {lead_name} if needed.

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
      "可用 skill 名（catalog）：{skill_catalog}",
      "加载方式：`skill({ name: \"<name>\" })` 或 read 对应 `SKILL.md`；勿期望全文自动注入。",
      "Mission 执行期勿提炼 skill；{lead_name}验收且复盘启动后，Gatehouse 会单独下发提炼指引。",
    ].join("\n"),
    en: [
      "---",
      "Domain `{skill_domain}` skills live under `{skill_domain_path}`",
      "Available skill names (catalog): {skill_catalog}",
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
  "dispatch.teamSnapshot.executionHeader": { zh: "### 执行树", en: "### Execution tree" },
  "dispatch.teamSnapshot.outerHeader": { zh: "### 外层联系人", en: "### Outer contacts" },
  "dispatch.teamSnapshot.you": { zh: "（你）", en: " (you)" },
  "dispatch.teamSnapshot.parent": { zh: "`parent: {parent}`", en: "`parent: {parent}`" },
  "dispatch.teamSnapshot.children": { zh: "下属: {list}", en: "children: {list}" },
  "dispatch.teamSnapshot.outerHint": {
    zh: "核心团队（建队已完成）；执行期勿联系；structural root 全树完成时 `gatehouse_execution_complete` 自动通知 lead",
    en: "Core team (team build complete); do not contact during execution; structural root auto-notifies lead on final gatehouse_execution_complete",
  },
  "dispatch.teamSnapshot.teamspecHeader": { zh: "### 执行团队节点", en: "### Execution team nodes" },
  "dispatch.teamSnapshot.subtreeHeader": {
    zh: "### 所辖执行分支（启动快照）\n\n你是**中间协调层**（`build-coordinator`）：仅管理此分支；**禁止**联系 lead。按协作脚本工单执行；完成后 `gatehouse_execution_complete`。工单可能附带「下属节点交付」— 只引用路径，勿复述正文。",
    en: "### Your execution subtree (kickoff snapshot)\n\nYou are an **intermediate coordinator** (`build-coordinator`): manage this branch only; **do not** contact lead. Follow collaboration-script work orders; call `gatehouse_execution_complete` when done. Work orders may include referenced child completions — paths only, do not copy bodies.",
  },
  "dispatch.teamSnapshot.noNonRootNodes": { zh: "（无下属节点）", en: "(no delegate nodes)" },
  "execution.nodeRole.header": {
    zh: "## 节点角色（Node Role · {node_id}）",
    en: "## Node role ({node_id})",
  },
  "execution.nodeRole.description": {
    zh: "**职责：** {description}",
    en: "**Role:** {description}",
  },
  "execution.nodeRole.briefHint": {
    zh: "**任务与边界：** `gatehouse_mission_info`（编排器通过 `setBrief` 写入本节点任务书）。",
    en: "**Mission scope:** `gatehouse_mission_info` (orchestrator writes your node brief via `setBrief`).",
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
    zh: "**任务与边界：** `gatehouse_mission_info`",
    en: "**Mission scope:** `gatehouse_mission_info`",
  },
  "execution.workOrder.missingBriefWarning": {
    zh: "**⚠ 任务书缺失：** 编排器未对本节点调用 `ctx.setBrief`。请用 `gatehouse_mission_info`（协调者可见 contract）或激活消息中的上下文行动；并通知 {lead_name} 修正 mission.script.ts。",
    en: "**⚠ Missing node brief:** orchestrator did not call `ctx.setBrief` for this node. Use `gatehouse_mission_info` (coordinators see contract) or activation context; notify {lead_name} to fix mission.script.ts.",
  },
  "execution.workOrder.planRef": {
    zh: "**执行进度：** `gatehouse_execution_status`",
    en: "**Execution progress:** `gatehouse_execution_status`",
  },
  "execution.workOrder.completeHint": {
    zh: "完成后调用 `gatehouse_execution_complete(summary=..., artifacts=[{path,description}], risks=?)` — 真实产出在项目目录，artifacts 只列路径与描述。",
    en: "When done, call `gatehouse_execution_complete(summary=..., artifacts=[{path,description}], risks=?)` — deliverables live in the project; list paths and descriptions only.",
  },
  "execution.workOrder.reworkHint": {
    zh: "依赖产出不合格（含小范围修正）且你仍在 running：`gatehouse_execution_rework(blocked_by=..., reason=..., evidence_path=...)` — reason 只写最小修改面，不要求整单重做。",
    en: "Dependency output is wrong (including a small fix) while you are still running: `gatehouse_execution_rework(blocked_by=..., reason=..., evidence_path=...)` — reason states the minimal change only; unrelated work stays done.",
  },
  "execution.workOrder.peerMessageHint": {
    zh: "同伴仍在 running、尚未 complete，只需对齐或指出几处改动：`gatehouse_send_message`（写清具体修改）；不改编排。",
    en: "Peer still running and not yet complete — align or point to specific edits: `gatehouse_send_message` (exact change); does not change orchestration.",
  },
  "execution.workOrder.reworkNotSendMessage": {
    zh: "勿用 send_message 代替 rework（对方已 complete 或你必须等其修正后再 complete 时）。",
    en: "Do not use send_message instead of rework when they already completed or orchestration must wait for their fix.",
  },
  "execution.workOrder.reworkScopeHint": {
    zh: "仅按上述修正要求改动；无需重做无关部分。完成后 `gatehouse_execution_complete`。",
    en: "Change only what the correction scope requires; do not redo unrelated work. Then call `gatehouse_execution_complete`.",
  },
  "completion.rollup.header": {
    zh: "## 下属节点交付",
    en: "## Referenced node completions",
  },
  "completion.rollup.hint": {
    zh: "以下为下属节点汇报摘要；**勿**展开 artifact 正文，只引用路径与描述。",
    en: "Child completion summaries below; **do not** paste artifact bodies — reference paths and descriptions only.",
  },
  "completion.rollup.nodeHeader": { zh: "节点 {node_id}", en: "Node {node_id}" },
  "completion.rollup.artifactsHeader": { zh: "**变更 / 证据**", en: "**Changes / evidence**" },
  "completion.rollup.risksHeader": { zh: "**未完成 / 风险**", en: "**Open items / risks**" },
  "completion.rollup.missing": {
    zh: "（无汇报摘要）",
    en: "(no completion summary)",
  },
  "completion.rootDelivery.title": { zh: "任务交付索引 · {mission_id}", en: "Mission delivery index · {mission_id}" },
  "completion.rootDelivery.generated": {
    zh: "> 协调索引：列路径与摘要，供验收对照；交付正文在项目目录。",
    en: "> Coordination index: paths and summaries for acceptance review; deliverable bodies live in the project tree.",
  },
  "completion.rootDelivery.rootSummary": { zh: "本节点摘要", en: "This node summary" },
  "completion.rootDelivery.rootArtifacts": { zh: "**本节点产出**", en: "**This node artifacts**" },
  "completion.rootDelivery.childRollup": { zh: "下属节点汇报", en: "Direct-report summaries" },
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
  "delivery.submit.reportPath": { zh: "**报告路径：** {report_path}", en: "**Report path:** {report_path}" },
  "delivery.submit.recordPath": {
    zh: "**结构化记录：** {record_path}",
    en: "**Structured record:** {record_path}",
  },
  "delivery.submit.summaryHeader": { zh: "**交付摘要：**", en: "**Summary:**" },
  "delivery.submit.rollupHeader": { zh: "**节点汇报汇总：**", en: "**Node completion rollup:**" },
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
    en: "The rollup and precheck above are for review — **not** Portal deliverable bodies. After the user confirms acceptance, call `gatehouse_mission_complete(done, publish_deliverables=true)` to publish project paths from done_when.",
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
    zh: "返工完成后再次调用 `gatehouse_execution_complete(summary=..., artifacts=...)`；全树节点均 done 时系统自动通知 lead 验收。",
    en: "When rework is done, call `gatehouse_execution_complete(summary=..., artifacts=...)` again; the system notifies lead automatically once all nodes are done.",
  },
  "retro.kickoff.contextHeader": { zh: "## 所辖分支（启动快照）", en: "## Your subtree (kickoff snapshot)" },
  "retro.kickoff.scopeNodes": { zh: "**node_ids：** {list}", en: "**node_ids:** {list}" },
  "retro.kickoff.order": {
    zh: "**retro 顺序：** 第 {position} / {total} 个 manager 节点",
    en: "**Retro order:** manager node {position} of {total}",
  },
  "retro.kickoff.metricsSummary": {
    zh: "**API 级汇总：** sessions={sessions} · assistant_messages={assistant_messages} · tokens_total={tokens_total} · tool_calls={tool_calls} · tool_errors={tool_errors}",
    en: "**API-level rollup:** sessions={sessions} · assistant_messages={assistant_messages} · tokens_total={tokens_total} · tool_calls={tool_calls} · tool_errors={tool_errors}",
  },
  "retro.kickoff.contextPaths": {
    zh: "详细原始数据：`.gatehouse/trees/{mission_id}/context/`（messages / timeline / metrics / subtree-metrics）。",
    en: "Raw data lives under `.gatehouse/trees/{mission_id}/context/` (messages / timeline / metrics / subtree-metrics).",
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
