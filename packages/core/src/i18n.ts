import type { GatehouseLocale } from "./locale.ts"

type MessageTable = Record<string, { zh: string; en: string }>

const messages = {
  "bulletList.empty": { zh: "（无）", en: "(none)" },
  "mission.objectiveMissing": { zh: "（mission 未提供 objective）", en: "(mission has no objective)" },
  "curator.objectiveFallback": { zh: "（见 gatehouse_mission_current）", en: "(see gatehouse_mission_current)" },
  "mission.status.ended": { zh: "已结束", en: "ended" },
  "mission.status.cancelled": { zh: "已取消", en: "cancelled" },
  "mission.started": {
    zh: `[Gatehouse · Mission 已启动 · {mission_id}]

{lead_name} 已通过 gatehouse_mission_start 启动本 Mission。请调用 **gatehouse_mission_current** 获取任务全文（objective / done_when / must_not / notes）。

下一步：在 \`.gatehouse/architect/trees/{mission_id}/\` 编写 teamspec.yaml，完成后 **gatehouse_bootstrap_tree**。`,
    en: `[Gatehouse · Mission started · {mission_id}]

{lead_name} started this Mission via gatehouse_mission_start. Call **gatehouse_mission_current** for the full brief (objective / done_when / must_not / notes).

Next: write teamspec.yaml under \`.gatehouse/architect/trees/{mission_id}/\`, then **gatehouse_bootstrap_tree**.`,
  },
  "mission.ended": {
    zh: `[Gatehouse · Mission {mission_id} {status_label}]

{lead_name} 已通过 gatehouse_mission_complete 结束本轮 Mission（missions.yaml → {status}）。Mission 执行团队相关 OpenCode session 已中止；请勿再分配任务、投递或等待本轮交付。`,
    en: `[Gatehouse · Mission {mission_id} {status_label}]

{lead_name} closed this Mission via gatehouse_mission_complete (missions.yaml → {status}). OpenCode sessions for the execution team have been stopped; do not assign work, deliver, or wait for this round.`,
  },
  "retro.batchReady": {
    zh: `[Gatehouse 复盘就绪 · Mission {mission_id}]

全部 manager 复盘节点已完成并登记。请阅读下列报告，撰写 \`.gatehouse/architect/trees/{mission_id}/reports/architect-summary.md\`。

**必做：** 汇总各 retro 的「工具贡献」→ 整理 \`.gatehouse/architect/retro-toolkit/\`（promote 有效脚本、更新 SKILL、演进 retro 规范）→ 更新 meta-skill → \`gatehouse_send_message(recipient="lead", ...)\` 通知{lead_name}。

{lines}

retro coord 数据源为 \`context/\`（messages、timeline、metrics、subtree-metrics）；语义特征提取靠 retro-toolkit 自制脚本，非 Gatehouse 预分析插件。

复盘启动时已向 manifest 中由{curator_name}分配的各 \`skill_domain\` 执行 session 自动下发 \`prompts/domain-skill-extract.md\`（Gatehouse 系统消息）；全部登记后{curator_name}会收到汇总通知。`,
    en: `[Gatehouse · Retro ready · Mission {mission_id}]

All manager retro nodes are complete and recorded. Read the reports below and write \`.gatehouse/architect/trees/{mission_id}/reports/architect-summary.md\`.

**Required:** Summarize each retro's tool contributions → curate \`.gatehouse/architect/retro-toolkit/\` (promote useful scripts, update SKILL, evolve retro norms) → update meta-skill → \`gatehouse_send_message(recipient="lead", ...)\` to notify {lead_name}.

{lines}

Retro coord data comes from \`context/\` (messages, timeline, metrics, subtree-metrics); semantic extraction uses retro-toolkit scripts, not a Gatehouse pre-analysis plugin.

When retro started, Gatehouse auto-delivered \`prompts/domain-skill-extract.md\` to exec sessions with \`skill_domain\` assigned by {curator_name}; after all are recorded, {curator_name} gets a summary notification.`,
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
      "可查阅领域 skill（自行 read，勿期望全文注入）：`{skill_domain_path}`",
      "Mission 执行期勿提炼 skill；{lead_name}验收且复盘启动后，Gatehouse 会单独下发提炼指引。",
    ].join("\n"),
    en: [
      "---",
      "Domain skills available (read yourself; do not expect full injection): `{skill_domain_path}`",
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
