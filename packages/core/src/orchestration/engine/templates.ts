import { readLocaleSync, type GatehouseLocale } from "../../locale.ts"
import { gatehouseMessage } from "../../i18n.ts"

function formatWorkOrderTextWithLocale(
  locale: GatehouseLocale,
  input: {
    missionId: string
    nodeId: string
    context?: string
  },
) {
  const header = gatehouseMessage("execution.workOrder.activateHeader", locale, { node_id: input.nodeId })
  const lines = [header, "", `**Mission ID：** ${input.missionId}`, `**Node：** ${input.nodeId}`]
  if (input.context) lines.push("", gatehouseMessage("execution.workOrder.contextHeader", locale), input.context.trim())
  lines.push(
    "",
    gatehouseMessage("execution.workOrder.missionInfoRef", locale),
  )
  return lines.join("\n")
}

export function createWorkOrderTextFactory(input: {
  missionId: string
  locale?: GatehouseLocale
  projectDirectory?: string
}): (nodeId: string, supplementary?: string) => string {
  return (nodeId, supplementary) => {
    const payload = {
      missionId: input.missionId,
      nodeId,
      ...(supplementary?.trim() && { context: supplementary.trim() }),
    }
    const locale =
      input.locale ?? (input.projectDirectory !== undefined ? readLocaleSync(input.projectDirectory) : undefined)
    if (!locale) {
      throw new Error("createWorkOrderTextFactory requires locale or projectDirectory")
    }
    return formatWorkOrderTextWithLocale(locale, payload)
  }
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
    gatehouseMessage("execution.workOrder.missionInfoRef", locale),
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
    gatehouseMessage("execution.workOrder.blockerDone", locale, { blocker: input.blocker }),
  ]
  if (input.reason) {
    lines.push(gatehouseMessage("execution.workOrder.reworkReasonReview", locale, { reason: input.reason }))
  }
  lines.push("", gatehouseMessage("execution.workOrder.completeHint", locale))
  return lines.join("\n")
}

export function formatReworkResumeText(
  projectDirectory: string,
  input: { missionId: string; nodeId: string; blocker: string; reason?: string },
) {
  return formatReworkResumeTextWithLocale(readLocaleSync(projectDirectory), input)
}
