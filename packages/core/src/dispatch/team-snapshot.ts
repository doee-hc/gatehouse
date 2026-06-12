import { gatehouseMessage } from "../i18n.ts"
import type { GatehouseLocale } from "../locale.ts"
import { readLocaleSync } from "../locale.ts"
import {
  type ListTeamExecutionMember,
  type ListTeamOuterMember,
} from "../tools/list-views.ts"
import { childNodeIds, childNodeIdsFromSpec, manifestMembers, topologicalNodeOrder } from "../tree/parse.ts"
import type { TeamSpec, TreeManifest } from "../tree/types.ts"

function collectSpecSubtreeNodeIds(spec: TeamSpec, rootNodeId: string, includeRoot: boolean) {
  const ids: string[] = []
  const walk = (nodeId: string) => {
    if (!spec.nodes[nodeId]) return
    ids.push(nodeId)
    for (const childId of childNodeIdsFromSpec(spec, nodeId)) walk(childId)
  }
  if (includeRoot) walk(rootNodeId)
  else for (const childId of childNodeIdsFromSpec(spec, rootNodeId)) walk(childId)
  return ids
}

function manifestNodeOrder(manifest: TreeManifest) {
  const remaining = new Set(Object.keys(manifest.nodes))
  const ordered: string[] = []
  while (remaining.size) {
    const next = [...remaining].find((nodeId) => {
      const parent = manifest.nodes[nodeId]?.parent ?? null
      return parent === null || !remaining.has(parent)
    })
    if (!next) break
    remaining.delete(next)
    ordered.push(next)
  }
  return ordered
}

function orderExecutionMembers(members: ListTeamExecutionMember[], manifest?: TreeManifest) {
  if (!manifest) return members
  const index = new Map(manifestNodeOrder(manifest).map((nodeId, i) => [nodeId, i]))
  return [...members].sort((a, b) => (index.get(a.node_id) ?? 0) - (index.get(b.node_id) ?? 0))
}

function formatExecutionMemberLine(
  member: ListTeamExecutionMember,
  youNodeId: string | undefined,
  locale: GatehouseLocale,
) {
  const you =
    youNodeId === member.node_id ? gatehouseMessage("dispatch.teamSnapshot.you", locale) : ""
  const parent =
    member.parent === null
      ? "`parent: null`"
      : gatehouseMessage("dispatch.teamSnapshot.parent", locale, { parent: member.parent })
  const description = member.description ? ` — ${member.description}` : ""
  const children =
    member.children && member.children.length > 0
      ? ` · ${gatehouseMessage("dispatch.teamSnapshot.children", locale, {
          list: member.children.join(", "),
        })}`
      : ""
  return `- **${member.node_id}**${you} · ${parent}${description}${children}`
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
    parent: member.parent,
    ...(member.description && { description: member.description }),
    ...(member.display_name && { display_name: member.display_name }),
    ...(member.profile && { profile: member.profile }),
    ...(member.child_nodes.length > 0 && { children: member.child_nodes }),
  }))
  return formatExecutionTeamSnapshot(members, {
    youNodeId: manifest.root_node,
    locale,
    manifest,
  })
}

export function formatNonRootNodeIdList(manifest: TreeManifest, locale: GatehouseLocale) {
  const nodeIds = Object.keys(manifest.nodes).filter((nodeId) => nodeId !== manifest.root_node)
  if (nodeIds.length === 0) return gatehouseMessage("dispatch.teamSnapshot.noNonRootNodes", locale)
  return nodeIds.map((nodeId) => `- \`${nodeId}\``).join("\n")
}

export function formatTeamSpecAssignmentSummary(spec: TeamSpec, locale: GatehouseLocale) {
  const lines = [gatehouseMessage("dispatch.teamSnapshot.teamspecHeader", locale)]
  for (const nodeId of topologicalNodeOrder(spec)) {
    const node = spec.nodes[nodeId]
    if (!node) continue
    const parent =
      node.parent === null
        ? "`parent: null`"
        : gatehouseMessage("dispatch.teamSnapshot.parent", locale, { parent: node.parent })
    const children = childNodeIdsFromSpec(spec, nodeId)
    const childSuffix =
      children.length > 0
        ? ` · ${gatehouseMessage("dispatch.teamSnapshot.children", locale, { list: children.join(", ") })}`
        : ""
    lines.push(`- **${nodeId}** · ${parent} — ${node.description.trim()}${childSuffix}`)
  }
  return lines.join("\n")
}

export function formatCoordinatorSubtreeSnapshot(spec: TeamSpec, coordinatorNodeId: string, locale: GatehouseLocale) {
  const nodeIds = collectSpecSubtreeNodeIds(spec, coordinatorNodeId, true)
  const lines = [gatehouseMessage("dispatch.teamSnapshot.subtreeHeader", locale)]
  for (const nodeId of nodeIds) {
    const node = spec.nodes[nodeId]
    if (!node) continue
    const you =
      nodeId === coordinatorNodeId ? gatehouseMessage("dispatch.teamSnapshot.you", locale) : ""
    const parent =
      node.parent === null
        ? "`parent: null`"
        : gatehouseMessage("dispatch.teamSnapshot.parent", locale, { parent: node.parent })
    const children = childNodeIdsFromSpec(spec, nodeId)
    const childSuffix =
      children.length > 0
        ? ` · ${gatehouseMessage("dispatch.teamSnapshot.children", locale, { list: children.join(", ") })}`
        : ""
    lines.push(`- **${nodeId}**${you} · ${parent} — ${node.description.trim()}${childSuffix}`)
  }
  return lines.join("\n")
}

export function formatSubtreeSnapshotFromManifest(
  manifest: TreeManifest,
  coordinatorNodeId: string,
  locale: GatehouseLocale,
) {
  const nodeIds = (() => {
    const ids: string[] = []
    const walk = (nodeId: string) => {
      if (!manifest.nodes[nodeId]) return
      ids.push(nodeId)
      for (const childId of childNodeIds(manifest, nodeId)) walk(childId)
    }
    walk(coordinatorNodeId)
    return ids
  })()
  const members = manifestMembers(manifest).filter((member) => nodeIds.includes(member.node_id))
  return formatExecutionTeamSnapshot(
    members.map((member) => ({
      node_id: member.node_id,
      parent: member.parent,
      ...(member.description && { description: member.description }),
      ...(member.display_name && { display_name: member.display_name }),
      ...(member.profile && { profile: member.profile }),
      ...(member.child_nodes.length > 0 && { children: member.child_nodes }),
    })),
    { youNodeId: coordinatorNodeId, locale, manifest },
  )
}
