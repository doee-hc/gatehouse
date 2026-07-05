import { INNER_EXECUTION_AGENT } from "../registry/types.ts"
import type { OrchestrationPlan } from "../orchestration/plan-types.ts"
import { dependsOnDeliverableNodes } from "../orchestration/plan-graph.ts"
import type { TeamSpec, TeamSpecNode, TreeManifest, TreeNode } from "./types.ts"
import { isRecord, parseYaml, readString } from "../yaml.ts"

function parseTeamSpecNode(value: unknown, nodeId: string): TeamSpecNode | undefined {
  if (!isRecord(value)) return
  if (value.constraints !== undefined) {
    throw new Error(
      `TeamSpec node ${nodeId} must not include constraints; use ctx.run({ brief: ... }) in mission.script.ts orchestrate()`,
    )
  }
  const description = readString(value.description)
  const skill_domain = readString(value.skill_domain)
  if (description === undefined) return
  return {
    description,
    ...(skill_domain && { skill_domain }),
  }
}

export function parseTeamSpec(text: string): TeamSpec {
  const raw = parseYaml(text)
  if (!isRecord(raw)) throw new Error("TeamSpec must be a YAML mapping")
  const mission_id = readString(raw.mission_id)
  const terminal = readString(raw.terminal) ?? readString(raw.root)
  if (!mission_id || !terminal) throw new Error("TeamSpec requires mission_id and terminal")
  if (!isRecord(raw.nodes)) throw new Error("TeamSpec requires nodes mapping")
  const nodes: Record<string, TeamSpecNode> = {}
  for (const [nodeId, nodeValue] of Object.entries(raw.nodes)) {
    if (isRecord(nodeValue) && nodeValue.profile !== undefined) {
      throw new Error(
        `TeamSpec node ${nodeId} must not include profile (bootstrap assigns build from topology)`,
      )
    }
    const node = parseTeamSpecNode(nodeValue, nodeId)
    if (!node) throw new Error(`Invalid TeamSpec node: ${nodeId}`)
    nodes[nodeId] = node
  }
  if (!nodes[terminal]) throw new Error(`TeamSpec terminal node missing: ${terminal}`)
  return { mission_id, terminal, nodes }
}

function parseTreeNode(value: unknown, nodeId: string): TreeNode | undefined {
  if (!isRecord(value)) return
  const session_id = readString(value.session_id)
  if (!session_id) return
  const display_name = readString(value.display_name)
  const description = readString(value.description)
  const profile = readString(value.profile)
  const skill_domain = readString(value.skill_domain)
  return {
    session_id,
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
  const terminal_node = readString(raw.terminal_node) ?? readString(raw.root_node)
  const status = readString(raw.status)
  const created_at = readString(raw.created_at)
  if (!mission_id || !terminal_node || !created_at) throw new Error("manifest missing required fields")
  if (status !== "running" && status !== "archived") throw new Error("manifest status must be running or archived")
  if (!isRecord(raw.nodes)) throw new Error("manifest requires nodes")
  const nodes: Record<string, TreeNode> = {}
  for (const [nodeId, nodeValue] of Object.entries(raw.nodes)) {
    const node = parseTreeNode(nodeValue, nodeId)
    if (!node) throw new Error(`Invalid manifest node: ${nodeId}`)
    nodes[nodeId] = node
  }
  const archived_at = readString(raw.archived_at)
  return {
    mission_id,
    status,
    terminal_node,
    created_at,
    nodes,
    ...(archived_at && { archived_at }),
  }
}

/** True when the execution tree has only one node (solo execution). */
export function isSoloExecutionTeam(manifest: TreeManifest) {
  return Object.keys(manifest.nodes).length === 1
}

export function isTeamTerminalNode(spec: TeamSpec, nodeId: string) {
  return spec.terminal === nodeId
}

/** All inner execution nodes use the build profile. */
export function resolveInnerProfile(_spec: TeamSpec, _nodeId: string) {
  return INNER_EXECUTION_AGENT
}

export function modelForInnerNode(
  models: { executor?: string; coordinator?: string },
  plan: OrchestrationPlan,
  nodeId: string,
) {
  return dependsOnDeliverableNodes(plan, nodeId).length > 0 ? models.coordinator : models.executor
}

export function manifestMembers(manifest: TreeManifest): import("./types.ts").TreeMember[] {
  return Object.entries(manifest.nodes).map(([node_id, node]) => ({
    node_id,
    session_id: node.session_id,
    ...(node.display_name && { display_name: node.display_name }),
    ...(node.description && { description: node.description }),
    ...(node.profile && { profile: node.profile }),
  }))
}

export function validateTeamSpec(spec: TeamSpec) {
  for (const [nodeId, node] of Object.entries(spec.nodes)) {
    const raw = node as TeamSpecNode & { constraints?: unknown }
    if (raw.constraints !== undefined) {
      throw new Error(
        `TeamSpec node ${nodeId} must not include constraints; use ctx.run({ brief: ... }) in mission.script.ts orchestrate()`,
      )
    }
    if (!node.description.trim()) throw new Error(`TeamSpec node ${nodeId} requires a non-empty description`)
    resolveInnerProfile(spec, nodeId)
  }
  resolveInnerProfile(spec, spec.terminal)
  if (!spec.nodes[spec.terminal]) throw new Error("TeamSpec terminal missing from nodes")
}
