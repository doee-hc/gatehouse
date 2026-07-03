import { gatehouseMessage } from "../i18n.ts"
import type { GatehouseLocale } from "../locale.ts"
import { readLocaleSync } from "../locale.ts"
import type { OrchestrationPlan } from "../orchestration/plan-types.ts"
import {
  planChildNodeIds,
  planSummaryDescendantNodeIds,
  teamNodeOrder,
} from "../orchestration/plan-graph.ts"
import {
  type ListTeamExecutionMember,
  type ListTeamOuterMember,
} from "../tools/list-views.ts"
import { manifestMembers } from "../tree/parse.ts"
import type { TeamSpec, TreeManifest } from "../tree/types.ts"

function orderExecutionMembers(members: ListTeamExecutionMember[], manifest?: TreeManifest) {
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
  input: { youNodeId?: string; outer?: ListTeamOuterMember[]; locale: GatehouseLocale; manifest?: TreeManifest },
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

export function formatExecutionTeamSnapshotFromManifest(manifest: TreeManifest, locale: GatehouseLocale) {
  const members: ListTeamExecutionMember[] = manifestMembers(manifest).map((member) => ({
    node_id: member.node_id,
    ...(member.description && { description: member.description }),
    ...(member.display_name && { display_name: member.display_name }),
    ...(member.profile && { profile: member.profile }),
  }))
  return formatExecutionTeamSnapshot(members, {
    youNodeId: manifest.terminal_node,
    locale,
    manifest,
  })
}

export function formatNonTerminalNodeIdList(manifest: TreeManifest, locale: GatehouseLocale) {
  const nodeIds = Object.keys(manifest.nodes).filter((nodeId) => nodeId !== manifest.terminal_node)
  if (nodeIds.length === 0) return gatehouseMessage("dispatch.teamSnapshot.noNonTerminalNodes", locale)
  return nodeIds.map((nodeId) => `- \`${nodeId}\``).join("\n")
}

export function formatTeamSpecAssignmentSummary(spec: TeamSpec, locale: GatehouseLocale) {
  const lines = [gatehouseMessage("dispatch.teamSnapshot.teamspecHeader", locale)]
  for (const nodeId of teamNodeOrder(spec)) {
    const node = spec.nodes[nodeId]
    if (!node) continue
    lines.push(`- **${nodeId}** — ${node.description.trim()}`)
  }
  return lines.join("\n")
}

export function formatAcceptanceSubtreeSnapshot(
  spec: TeamSpec,
  plan: OrchestrationPlan,
  acceptanceNodeId: string,
  locale: GatehouseLocale,
) {
  const allowed = new Set<string>([acceptanceNodeId, ...planSummaryDescendantNodeIds(plan, acceptanceNodeId)])
  const nodeIds = teamNodeOrder(spec, plan).filter((nodeId) => allowed.has(nodeId))
  const lines = [gatehouseMessage("dispatch.teamSnapshot.subtreeHeader", locale)]
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

export function formatSubtreeSnapshotFromManifest(
  manifest: TreeManifest,
  acceptanceNodeId: string,
  locale: GatehouseLocale,
) {
  const members = manifestMembers(manifest).filter((member) => member.node_id === acceptanceNodeId)
  return formatExecutionTeamSnapshot(
    members.map((member) => ({
      node_id: member.node_id,
      ...(member.description && { description: member.description }),
      ...(member.display_name && { display_name: member.display_name }),
      ...(member.profile && { profile: member.profile }),
    })),
    { youNodeId: acceptanceNodeId, locale, manifest },
  )
}
