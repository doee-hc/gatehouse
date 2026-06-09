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

下一步：在 \`.gatehouse/trees/{mission_id}/\` 编写 teamspec.yaml，完成后 **gatehouse_bootstrap_tree**。若需刷新任务快照，可调用 **gatehouse_mission_current**。`,
    en: `[Gatehouse · Mission started · {mission_id}]

{lead_name} started this Mission via gatehouse_mission_start.

{mission_contract}

Next: write teamspec.yaml under \`.gatehouse/trees/{mission_id}/\`, then **gatehouse_bootstrap_tree**. Call **gatehouse_mission_current** to refresh the snapshot if needed.`,
  },
  "mission.started.fallback": {
    zh: `[Gatehouse · Mission 已启动 · {mission_id}]

{lead_name} 已通过 gatehouse_mission_start 启动本 Mission；registry 快照暂不可用，请调用 **gatehouse_mission_current**。`,
    en: `[Gatehouse · Mission started · {mission_id}]

{lead_name} started this Mission via gatehouse_mission_start; registry snapshot unavailable — call **gatehouse_mission_current**.`,
  },
  "mission.ended": {
    zh: `[Gatehouse · Mission {mission_id} {status_label}]

{lead_name} 已通过 gatehouse_mission_complete 结束本轮 Mission（missions.yaml → {status}）。Mission 执行团队相关 OpenCode session 已中止；请勿再分配任务、投递或等待本轮交付。`,
    en: `[Gatehouse · Mission {mission_id} {status_label}]

{lead_name} closed this Mission via gatehouse_mission_complete (missions.yaml → {status}). OpenCode sessions for the execution team have been stopped; do not assign work, deliver, or wait for this round.`,
  },
  "retro.batchReady": {
    zh: `[Gatehouse 复盘就绪 · Mission {mission_id}]

全部 manager 复盘节点已完成并登记。请阅读下列报告，撰写 \`.gatehouse/trees/{mission_id}/reports/architect-summary.md\`。

**必做：** 汇总各 retro 的「工具贡献」→ 整理 \`.gatehouse/skills/retro-toolkit/\`（promote 有效脚本、更新 SKILL、演进 retro 规范）→ 更新 architect-meta skill → \`gatehouse_send_message(recipient="lead", ...)\` 通知{lead_name}。

{lines}

retro coord 数据源为 \`context/\`（messages、timeline、metrics、subtree-metrics）；语义特征提取靠 retro-toolkit 自制脚本，非 Gatehouse 预分析插件。`,
    en: `[Gatehouse · Retro ready · Mission {mission_id}]

All manager retro nodes are complete and recorded. Read the reports below and write \`.gatehouse/trees/{mission_id}/reports/architect-summary.md\`.

**Required:** Summarize each retro's tool contributions → curate \`.gatehouse/skills/retro-toolkit/\` (promote useful scripts, update SKILL, evolve retro norms) → update architect-meta skill → \`gatehouse_send_message(recipient="lead", ...)\` to notify {lead_name}.

{lines}

Retro coord data comes from \`context/\` (messages, timeline, metrics, subtree-metrics); semantic extraction uses retro-toolkit scripts, not a Gatehouse pre-analysis plugin.`,
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
    zh: "核心团队（建队已完成）；执行期勿联系；交付后仅 `gatehouse_send_message(recipient=\"lead\")`",
    en: "Core team (team build complete); do not contact during execution; after delivery only `gatehouse_send_message(recipient=\"lead\")`",
  },
  "dispatch.teamSnapshot.teamspecHeader": { zh: "### TeamSpec 节点", en: "### TeamSpec nodes" },
  "dispatch.teamSnapshot.subtreeHeader": {
    zh: "### 所辖执行分支（启动快照）\n\n你是**中间协调层**（`build-coordinator`）：仅管理此分支；**禁止**联系 lead；子树完成后向父节点汇报。",
    en: "### Your execution subtree (kickoff snapshot)\n\nYou are an **intermediate coordinator** (`build-coordinator`): manage this branch only; **do not** contact lead; report upstream to parent when done.",
  },
  "dispatch.teamSnapshot.noNonRootNodes": { zh: "（无下属节点）", en: "(no delegate nodes)" },
  "dispatch.teamSnapshot.watchdogSnapshotHeader": {
    zh: "### 执行团队（当前快照）",
    en: "### Execution team (current snapshot)",
  },
  "dispatch.teamSnapshot.watchdogSnapshotNodesHeader": {
    zh: "### 待 snapshot 排查的非根 node_id",
    en: "### Non-root node_id values to snapshot once each",
  },
  "mission.contract.header": { zh: "## 任务快照（registry 冻结）", en: "## Mission snapshot (registry freeze)" },
  "mission.contract.missionId": { zh: "**任务 ID：** {mission_id}", en: "**Mission ID:** {mission_id}" },
  "mission.contract.objectiveHeader": { zh: "**目标：**", en: "**Objective:**" },
  "mission.contract.doneWhenHeader": { zh: "**验收条件（done_when）：**", en: "**Acceptance criteria (done_when):**" },
  "mission.contract.mustNotHeader": { zh: "**边界（must_not）：**", en: "**Boundaries (must_not):**" },
  "mission.contract.notesHeader": { zh: "**备注（notes）：**", en: "**Notes:**" },
  "domains.registry.header": { zh: "### 已登记 domain-id", en: "### Registered domain ids" },
  "domains.registry.empty": { zh: "（domains.yaml 尚无条目）", en: "(no entries in domains.yaml yet)" },
  "delivery.lead.doneWhenHeader": {
    zh: "## 验收条件（done_when，供对照）",
    en: "## Acceptance criteria (done_when) for review",
  },
  "delivery.lead.refreshHint": {
    zh: "（registry 快照；可用 `gatehouse_mission_current` 刷新）",
    en: "(registry snapshot; call `gatehouse_mission_current` to refresh)",
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
