import { formatPrecheckSummary } from "./criteria.ts"
import type { DeliveryRecord } from "./types.ts"
import { gatehouseMessage } from "../i18n.ts"
import { readLocaleSync, type GatehouseLocale } from "../locale.ts"
import { bulletList } from "../missions/parse.ts"
import type { MissionContract } from "../missions/contract.ts"
import { deliveryDocumentRelPath } from "../paths.ts"

export function formatLeadDeliveryNotification(
  projectDirectory: string,
  input: {
    missionId: string
    record: DeliveryRecord
    contract?: MissionContract
    summary?: string
  },
) {
  const locale = readLocaleSync(projectDirectory)
  const lines = [
    gatehouseMessage("delivery.submit.leadHeader", locale, { mission_id: input.missionId }),
    "",
    gatehouseMessage("delivery.submit.version", locale, {
      version: String(input.record.version),
    }),
    gatehouseMessage("delivery.submit.reportPath", locale, {
      report_path: input.record.report_path,
    }),
    gatehouseMessage("delivery.submit.recordPath", locale, {
      record_path: deliveryDocumentRelPath(input.missionId),
    }),
  ]
  if (input.summary?.trim()) {
    lines.push("", gatehouseMessage("delivery.submit.summaryHeader", locale), input.summary.trim())
  }
  if (input.record.precheck.length > 0) {
    lines.push(
      "",
      gatehouseMessage("delivery.submit.precheckHeader", locale),
      formatPrecheckSummary(input.record.precheck, input.record.criteria).join("\n"),
    )
  }
  if (input.record.force_reason) {
    lines.push(
      "",
      gatehouseMessage("delivery.submit.forceReasonHeader", locale),
      input.record.force_reason,
    )
  }
  if (input.contract) {
    lines.push(
      "",
      gatehouseMessage("delivery.lead.doneWhenHeader", locale),
      bulletList(input.contract.done_when, locale),
      "",
      gatehouseMessage("delivery.lead.refreshHint", locale),
      "",
      gatehouseMessage("delivery.submit.portalHint", locale),
      "",
      gatehouseMessage("delivery.submit.reviewHint", locale),
    )
  }
  return lines.join("\n")
}

export function formatRevisionBriefMessage(
  projectDirectory: string,
  input: {
    missionId: string
    fromVersion: number
    toVersion: number
    record: DeliveryRecord
    revisionBrief: string
    failedCriteria: number[]
    userFeedback?: string
    mustNot: string[]
  },
) {
  const locale = readLocaleSync(projectDirectory)
  const failedLines = input.failedCriteria.flatMap((id) => {
    const criterion = input.record.criteria.find((item) => item.id === id)
    const precheck = input.record.precheck.find((item) => item.criterion_id === id)
    if (!criterion) return []
    const detail = precheck ? ` — precheck: ${precheck.detail}` : ""
    return [`- [${id}] ${criterion.text}${detail}`]
  })
  const lines = [
    gatehouseMessage("delivery.revision.header", locale, {
      mission_id: input.missionId,
      from_version: String(input.fromVersion),
      to_version: String(input.toVersion),
    }),
    "",
    gatehouseMessage("delivery.revision.failedHeader", locale),
    failedLines.length > 0 ? failedLines.join("\n") : gatehouseMessage("bulletList.empty", locale),
    "",
    gatehouseMessage("delivery.revision.briefHeader", locale),
    input.revisionBrief.trim(),
  ]
  if (input.userFeedback?.trim()) {
    lines.push("", gatehouseMessage("delivery.revision.userFeedbackHeader", locale), input.userFeedback.trim())
  }
  if (input.mustNot.length > 0) {
    lines.push("", gatehouseMessage("delivery.revision.mustNotHeader", locale), bulletList(input.mustNot, locale))
  }
  lines.push(
    "",
    gatehouseMessage("delivery.revision.submitHint", locale, { mission_id: input.missionId }),
  )
  return lines.join("\n")
}
