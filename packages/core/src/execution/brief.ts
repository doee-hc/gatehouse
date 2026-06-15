import { gatehouseMessage } from "../i18n.ts"
import { DEFAULT_GATEHOUSE_LOCALE, type GatehouseLocale } from "../locale.ts"
import { isRecord, parseYaml, readString } from "../yaml.ts"
import type { NodeBrief } from "./types.ts"

function parseStringList(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []))
}

export function parseNodeBrief(text: string, nodeId: string): NodeBrief {
  const raw = parseYaml(text)
  if (!isRecord(raw)) throw new Error(`node brief for ${nodeId} must be a mapping`)

  const your_work = parseStringList(raw.your_work)
  const not_your_job = parseStringList(raw.not_your_job)
  const acceptance_slice = parseStringList(raw.acceptance_slice)

  return {
    node_id: readString(raw.node_id) ?? nodeId,
    ...(readString(raw.role) && { role: readString(raw.role) }),
    your_work,
    not_your_job,
    acceptance_slice,
    ...(isRecord(raw.activation) && { activation: { mode: readString(raw.activation.mode) } }),
  }
}

export function formatNodeBriefBlock(
  brief: NodeBrief,
  locale: GatehouseLocale = DEFAULT_GATEHOUSE_LOCALE,
) {
  const lines = [gatehouseMessage("execution.nodeBrief.header", locale, { node_id: brief.node_id })]
  if (brief.role) lines.push(gatehouseMessage("execution.nodeBrief.role", locale, { role: brief.role }))
  if (brief.your_work.length) {
    lines.push("", gatehouseMessage("execution.nodeBrief.yourWorkHeader", locale))
    for (const item of brief.your_work) lines.push(`- ${item}`)
  }
  if (brief.not_your_job.length) {
    lines.push("", gatehouseMessage("execution.nodeBrief.notYourJobHeader", locale))
    for (const item of brief.not_your_job) lines.push(`- ${item}`)
  }
  if (brief.acceptance_slice.length) {
    lines.push("", gatehouseMessage("execution.nodeBrief.acceptanceSliceHeader", locale))
    for (const item of brief.acceptance_slice) lines.push(`- ${item}`)
  }
  lines.push("", gatehouseMessage("execution.nodeBrief.priorityHint", locale))
  return lines.join("\n")
}
