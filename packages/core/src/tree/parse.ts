import { INNER_COORDINATOR_AGENT, INNER_EXECUTION_AGENT } from "../registry/types.ts"
import type { TeamSpec, TeamSpecNode, TreeManifest, TreeNode } from "./types.ts"
import { isRecord, parseYaml, readString } from "../yaml.ts"

function parseTeamSpecNode(value: unknown): TeamSpecNode | undefined {
  if (!isRecord(value)) return
  const constraints = readString(value.constraints)
  if (constraints === undefined) return
  const parentRaw = value.parent
  const parent = parentRaw === null ? null : readString(parentRaw) ?? null
  const profile = readString(value.profile)
  const description = readString(value.description)
  const skill_domain = readString(value.skill_domain)
  if (description === undefined) return
  return {
    parent,
    description,
    constraints,
    ...(profile && { profile }),
    ...(skill_domain && { skill_domain }),
  }
}

export function parseTeamSpec(text: string): TeamSpec {
  const raw = parseYaml(text)
  if (!isRecord(raw)) throw new Error("TeamSpec must be a YAML mapping")
  const mission_id = readString(raw.mission_id)
  const root = readString(raw.root)
  if (!mission_id || !root) throw new Error("TeamSpec requires mission_id and root")
  if (!isRecord(raw.nodes)) throw new Error("TeamSpec requires nodes mapping")
  const nodes: Record<string, TeamSpecNode> = {}
  for (const [nodeId, nodeValue] of Object.entries(raw.nodes)) {
    const node = parseTeamSpecNode(nodeValue)
    if (!node) throw new Error(`Invalid TeamSpec node: ${nodeId}`)
    nodes[nodeId] = node
  }
  if (!nodes[root]) throw new Error(`TeamSpec root node missing: ${root}`)
  return { mission_id, root, nodes }
}

function parseTreeNode(value: unknown): TreeNode | undefined {
  if (!isRecord(value)) return
  const session_id = readString(value.session_id)
  if (!session_id) return
  const parentRaw = value.parent
  const parent = parentRaw === null ? null : readString(parentRaw) ?? null
  const display_name = readString(value.display_name)
  const description = readString(value.description)
  const profile = readString(value.profile)
  const skill_domain = readString(value.skill_domain)
  return {
    session_id,
    parent,
    ...(display_name && { display_name }),
    ...(description && { description }),
    ...(profile && { profile }),
    ...(skill_domain && { skill_domain }),
  }
}

export function parseTreeManifest(text: string): TreeManifest {
  const raw = parseYaml(text)
  if (!isRecord(raw)) throw new Error("manifest must be a YAML mapping")
  const mission_id = readString(raw.mission_id)
  const root_node = readString(raw.root_node)
  const status = readString(raw.status)
  const created_at = readString(raw.created_at)
  if (!mission_id || !root_node || !created_at) throw new Error("manifest missing required fields")
  if (status !== "running" && status !== "archived") throw new Error("manifest status must be running or archived")
  if (!isRecord(raw.nodes)) throw new Error("manifest requires nodes")
  const nodes: Record<string, TreeNode> = {}
  for (const [nodeId, nodeValue] of Object.entries(raw.nodes)) {
    const node = parseTreeNode(nodeValue)
    if (!node) throw new Error(`Invalid manifest node: ${nodeId}`)
    nodes[nodeId] = node
  }
  const archived_at = readString(raw.archived_at)
  return {
    mission_id,
    status,
    root_node,
    created_at,
    nodes,
    ...(archived_at && { archived_at }),
  }
}

export function childNodeIds(manifest: TreeManifest, nodeId: string) {
  return Object.entries(manifest.nodes)
    .filter(([, node]) => node.parent === nodeId)
    .map(([id]) => id)
}

/** True when the execution tree has only the structural root (no delegates). */
export function isSoloExecutionTeam(manifest: TreeManifest) {
  return Object.keys(manifest.nodes).length === 1
}

export function childNodeIdsFromSpec(spec: TeamSpec, nodeId: string) {
  return Object.entries(spec.nodes)
    .filter(([, node]) => node.parent === nodeId)
    .map(([id]) => id)
}

export function resolveInnerProfile(spec: TeamSpec, nodeId: string) {
  const node = spec.nodes[nodeId]
  if (!node) throw new Error(`TeamSpec missing node ${nodeId}`)
  if (node.profile) return node.profile
  if (childNodeIdsFromSpec(spec, nodeId).length > 0) return INNER_COORDINATOR_AGENT
  // Solo structural root (no children) still enters managerRetroOrder — use coordinator profile, not leaf build.
  if (node.parent === null && spec.root === nodeId) return INNER_COORDINATOR_AGENT
  return INNER_EXECUTION_AGENT
}

export function nodeDepth(manifest: TreeManifest, nodeId: string) {
  let depth = 0
  let current = manifest.nodes[nodeId]
  while (current?.parent) {
    depth += 1
    current = manifest.nodes[current.parent]
    if (depth > 64) break
  }
  return depth
}

/** Bottom-up order among manager nodes; solo structural root with no children is included. */
export function managerRetroOrder(manifest: TreeManifest) {
  const managers = Object.keys(manifest.nodes).filter((nodeId) => childNodeIds(manifest, nodeId).length > 0)
  if (managers.length > 0) {
    return managers.sort((a, b) => nodeDepth(manifest, b) - nodeDepth(manifest, a))
  }
  if (manifest.nodes[manifest.root_node]) return [manifest.root_node]
  return []
}

export function manifestMembers(manifest: TreeManifest): import("./types.ts").TreeMember[] {
  return Object.entries(manifest.nodes).map(([node_id, node]) => ({
    node_id,
    session_id: node.session_id,
    parent: node.parent,
    child_nodes: childNodeIds(manifest, node_id),
    ...(node.display_name && { display_name: node.display_name }),
    ...(node.description && { description: node.description }),
    ...(node.profile && { profile: node.profile }),
  }))
}

export function validateTeamSpec(spec: TeamSpec) {
  for (const [nodeId, node] of Object.entries(spec.nodes)) {
    if (!node.description.trim()) throw new Error(`TeamSpec node ${nodeId} requires a non-empty description`)
    if (node.parent === null) continue
    if (!spec.nodes[node.parent]) throw new Error(`TeamSpec node ${nodeId} references missing parent ${node.parent}`)
  }
  const order = topologicalNodeOrder(spec)
  if (!order.includes(spec.root)) throw new Error("TeamSpec root unreachable")
}

export function topologicalNodeOrder(spec: TeamSpec) {
  const remaining = new Set(Object.keys(spec.nodes))
  const ordered: string[] = []
  while (remaining.size) {
    const next = [...remaining].find((nodeId) => {
      const parent = spec.nodes[nodeId]?.parent ?? null
      return parent === null || !remaining.has(parent)
    })
    if (!next) throw new Error("TeamSpec contains a cycle")
    remaining.delete(next)
    ordered.push(next)
  }
  return ordered
}
