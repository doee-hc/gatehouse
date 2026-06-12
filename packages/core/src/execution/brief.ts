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

export function formatNodeBriefBlock(brief: NodeBrief) {
  const lines = [`## 节点任务书（Node Brief · ${brief.node_id}）`]
  if (brief.role) lines.push(`**角色：** ${brief.role}`)
  if (brief.your_work.length) {
    lines.push("", "**你的职责（your_work）：**")
    for (const item of brief.your_work) lines.push(`- ${item}`)
  }
  if (brief.not_your_job.length) {
    lines.push("", "**不是你的事（not_your_job）：**")
    for (const item of brief.not_your_job) lines.push(`- ${item}`)
  }
  if (brief.acceptance_slice.length) {
    lines.push("", "**本节点验收切片（acceptance_slice）：**")
    for (const item of brief.acceptance_slice) lines.push(`- ${item}`)
  }
  lines.push(
    "",
    "**优先级：** 以本 Brief 为行动依据；核对边界用 `gatehouse_mission_context`。协调者（build-root / build-coordinator）可读 `gatehouse_mission_contract`。",
  )
  return lines.join("\n")
}
