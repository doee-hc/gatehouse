import { gatehouseMessage } from "../i18n.ts"
import type { GatehouseLocale } from "../locale.ts"
import { readLocaleSync } from "../locale.ts"
import type { OrchestrationPlan } from "../orchestration/plan/types.ts"
import {
  planChildNodeIds,
  planDeliverableDescendantNodeIds,
  teamNodeOrder,
} from "../orchestration/plan/graph.ts"
import {
  type ListTeamExecutionMember,
  type ListTeamOuterMember,
} from "../tools/list-views.ts"
import type { MissionTeamSpec, MissionManifest } from "../missions/manifest/types.ts"

function orderExecutionMembers(members: ListTeamExecutionMember[], manifest?: MissionManifest) {
  if (!manifest) return [...members].sort((a, b) => a.node_id.localeCompare(b.node_id))
  const index = new Map(Object.keys(manifest.nodes).sort().map((nodeId, i) => [nodeId, i]))
  return [...members].sort((a, b) => (index.get(a.node_id) ?? 0) - (index.get(b.node_id) ?? 0))
}

function formatExecutionMemberLine(
  member: ListTeamExecutionMember,
  youNodeId: string | undefined,
  locale: GatehouseLocale,
) {
  const you =
    youNodeId === member.node_id ? gatehouseMessage("dispatch.teamSnapshot.you", locale) : ""
  const description = member.description ? ` — ${member.description}` : ""
  return `- **${member.node_id}**${you}${description}`
}

export function formatExecutionTeamSnapshot(
  members: ListTeamExecutionMember[],
  input: { youNodeId?: string; outer?: ListTeamOuterMember[]; locale: GatehouseLocale; manifest?: MissionManifest },
) {
  const lines: string[] = [gatehouseMessage("dispatch.teamSnapshot.executionHeader", input.locale)]
  for (const member of orderExecutionMembers(members, input.manifest)) {
    lines.push(formatExecutionMemberLine(member, input.youNodeId, input.locale))
  }
  if (input.outer?.length) {
    lines.push("")
    lines.push(gatehouseMessage("dispatch.teamSnapshot.outerHeader", input.locale))
    for (const contact of input.outer) {
      lines.push(
        `- **${contact.profile}** (${contact.display_name}) — ${gatehouseMessage("dispatch.teamSnapshot.outerHint", input.locale)}`,
      )
    }
  }
  return lines.join("\n")
}

export function formatMissionTeamSpecAssignmentSummary(spec: MissionTeamSpec, locale: GatehouseLocale) {
  const lines = [gatehouseMessage("dispatch.teamSnapshot.teamspecHeader", locale)]
  for (const nodeId of teamNodeOrder(spec)) {
    const node = spec.nodes[nodeId]
    if (!node) continue
    lines.push(`- **${nodeId}** — ${node.description.trim()}`)
  }
  return lines.join("\n")
}

export function formatAcceptanceBranchSnapshot(
  spec: MissionTeamSpec,
  plan: OrchestrationPlan,
  acceptanceNodeId: string,
  locale: GatehouseLocale,
) {
  const allowed = new Set<string>([acceptanceNodeId, ...planDeliverableDescendantNodeIds(plan, acceptanceNodeId)])
  const nodeIds = teamNodeOrder(spec, plan).filter((nodeId) => allowed.has(nodeId))
  const lines = [gatehouseMessage("dispatch.teamSnapshot.acceptanceBranchHeader", locale)]
  for (const nodeId of nodeIds) {
    const node = spec.nodes[nodeId]
    if (!node) continue
    const you =
      nodeId === acceptanceNodeId ? gatehouseMessage("dispatch.teamSnapshot.you", locale) : ""
    const children = planChildNodeIds(plan, nodeId)
    const childSuffix = children.length > 0 ? ` · depends on ${children.join(", ")}` : ""
    lines.push(`- **${nodeId}**${you} — ${node.description.trim()}${childSuffix}`)
  }
  return lines.join("\n")
}
