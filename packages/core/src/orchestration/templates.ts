import { readLocaleSync, type GatehouseLocale } from "../locale.ts"
import { gatehouseMessage } from "../i18n.ts"

export function formatWorkOrderTextWithLocale(
  locale: GatehouseLocale,
  input: {
    missionId: string
    nodeId: string
    context?: string
    note?: string
    wave?: number
  },
) {
  const header = gatehouseMessage("execution.workOrder.activateHeader", locale, { node_id: input.nodeId })
  const lines = [header, "", `**Mission ID：** ${input.missionId}`, `**Node：** ${input.nodeId}`]
  if (input.note) lines.push("", `**说明：** ${input.note}`)
  if (input.wave !== undefined) lines.push("", `**波次：** ${input.wave}`)
  if (input.context) lines.push("", "**上下文：**", input.context.trim())
  lines.push(
    "",
    gatehouseMessage("execution.workOrder.briefRef", locale),
    gatehouseMessage("execution.workOrder.contractRef", locale),
    gatehouseMessage("execution.workOrder.completeHint", locale),
    "",
    gatehouseMessage("execution.workOrder.peerMessageHint", locale),
    gatehouseMessage("execution.workOrder.reworkHint", locale),
    gatehouseMessage("execution.workOrder.reworkNotSendMessage", locale),
  )
  return lines.join("\n")
}

export function formatWorkOrderText(
  projectDirectory: string,
  input: {
    missionId: string
    nodeId: string
    context?: string
    note?: string
    wave?: number
  },
) {
  return formatWorkOrderTextWithLocale(readLocaleSync(projectDirectory), input)
}

export function formatReworkTextWithLocale(
  locale: GatehouseLocale,
  input: { missionId: string; nodeId: string; requester: string; reason: string; evidence?: string },
) {
  const header = gatehouseMessage("execution.workOrder.reworkHeader", locale, { node_id: input.nodeId })
  const lines = [
    header,
    "",
    `**Mission ID：** ${input.missionId}`,
    `**Node：** ${input.nodeId}`,
    gatehouseMessage("execution.workOrder.reworkBecause", locale, { reason: input.reason }),
    gatehouseMessage("execution.workOrder.reworkRequester", locale, { requester: input.requester }),
  ]
  if (input.evidence) {
    lines.push(gatehouseMessage("execution.workOrder.evidence", locale, { path: input.evidence }))
  }
  lines.push(
    "",
    gatehouseMessage("execution.workOrder.briefRef", locale),
    gatehouseMessage("execution.workOrder.completeHint", locale),
    "",
    gatehouseMessage("execution.workOrder.reworkScopeHint", locale),
  )
  return lines.join("\n")
}

export function formatReworkText(
  projectDirectory: string,
  input: { missionId: string; nodeId: string; requester: string; reason: string; evidence?: string },
) {
  return formatReworkTextWithLocale(readLocaleSync(projectDirectory), input)
}

export function formatReworkResumeTextWithLocale(
  locale: GatehouseLocale,
  input: { missionId: string; nodeId: string; blocker: string; reason?: string },
) {
  const lines = [
    gatehouseMessage("execution.workOrder.activateHeader", locale, { node_id: input.nodeId }),
    "",
    `**Mission ID：** ${input.missionId}`,
    `**Node：** ${input.nodeId}`,
    `**依赖节点 ${input.blocker} 已再次完成。**`,
  ]
  if (input.reason) lines.push(`**返工原因（回顾）：** ${input.reason}`)
  lines.push("", gatehouseMessage("execution.workOrder.completeHint", locale))
  return lines.join("\n")
}

export function formatReworkResumeText(
  projectDirectory: string,
  input: { missionId: string; nodeId: string; blocker: string; reason?: string },
) {
  return formatReworkResumeTextWithLocale(readLocaleSync(projectDirectory), input)
}
