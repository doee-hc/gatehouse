import { extractDependsOnFromStatement, type NormalizedDependsOn } from "../engine/depends-on.ts"
import type { OrchestrationPlan } from "./types.ts"
import {
  extractAsyncArrowBody,
  extractParallelTrackBodies,
  extractRunTargetFromStatement,
  extractTopLevelAwaitStatements,
} from "../script/source-parse.ts"
import type { MissionTeamSpec } from "../../missions/manifest/types.ts"
import { RegistryDatabase } from "../../registry/db.ts"
import type { RegistryAgent } from "../../registry/types.ts"

export type PlanExecutionTrack = {
  trackId: string
  nodeIds: string[]
}

export type PlanRunActivation = {
  targetNodeId: string
  dependsOn: NormalizedDependsOn[]
}

function extractNestedRunStatements(source: string) {
  const trimmed = source.trim()
  const boundaryPattern = /\bawait\s+ctx\.run\s*\(/gm
  const starts: number[] = []
  let match: RegExpExecArray | null
  while ((match = boundaryPattern.exec(trimmed)) !== null) {
    starts.push(match.index)
  }
  if (starts.length === 0) return []

  const statements: string[] = []
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i]!
    const end = i + 1 < starts.length ? starts[i + 1]! : trimmed.length
    const chunk = trimmed.slice(start, end).trim()
    if (chunk) statements.push(chunk)
  }
  return statements
}

/** Ordered run activations from plan steps (includes nested parallel tracks). */
export function listPlanRunActivations(plan: Pick<OrchestrationPlan, "steps">): PlanRunActivation[] {
  const activations: PlanRunActivation[] = []

  for (const step of plan.steps) {
    if (step.op === "run") {
      const targetNodeId = step.nodeId ?? extractRunTargetFromStatement(step.statement)
      if (!targetNodeId) continue
      activations.push({
        targetNodeId,
        dependsOn: extractDependsOnFromStatement(step.statement),
      })
      continue
    }
    if (step.op === "parallel" || step.op === "pipeline") {
      for (const innerStatement of extractNestedRunStatements(step.statement)) {
        const targetNodeId = extractRunTargetFromStatement(innerStatement)
        if (!targetNodeId) continue
        activations.push({
          targetNodeId,
          dependsOn: extractDependsOnFromStatement(innerStatement),
        })
      }
    }
  }

  return activations
}

/** Upstream dependsOn nodes declared for activations of `nodeId`. */
export function upstreamDependsOnNodes(plan: OrchestrationPlan, nodeId: string) {
  const upstream = new Set<string>()
  for (const activation of listPlanRunActivations(plan)) {
    if (activation.targetNodeId !== nodeId) continue
    for (const dep of activation.dependsOn) upstream.add(dep.node)
  }
  return upstream
}

/**
 * Terminal node: last plan run target that never appears as a dependsOn upstream
 * (topological sink). When several sinks exist, the last one in plan order wins.
 */
export function inferTerminalNodeFromPlan(plan: OrchestrationPlan): string | undefined {
  const activations = listPlanRunActivations(plan)
  if (activations.length === 0) return undefined

  const dependencyNodes = new Set<string>()
  for (const activation of activations) {
    for (const dep of activation.dependsOn) dependencyNodes.add(dep.node)
  }

  let terminal: string | undefined
  for (const activation of activations) {
    if (!dependencyNodes.has(activation.targetNodeId)) {
      terminal = activation.targetNodeId
    }
  }
  return terminal ?? activations[activations.length - 1]?.targetNodeId
}

export function resolveTerminalNode(input: { plan?: OrchestrationPlan | null }) {
  if (input.plan?.terminal_node) return input.plan.terminal_node
  if (input.plan) return inferTerminalNodeFromPlan(input.plan)
  return undefined
}

export function isMissionTerminalNode(nodeId: string | undefined, plan?: OrchestrationPlan | null) {
  if (!nodeId) return false
  const terminal = resolveTerminalNode({ plan })
  return Boolean(terminal && terminal === nodeId)
}

export function isTerminalInnerAgent(projectDirectory: string, agent: RegistryAgent) {
  if (agent.scope !== "inner" || !agent.missionId || !agent.nodeId) return false
  const db = new RegistryDatabase(projectDirectory, { readonly: true })
  const plan = db.getLatestOrchestrationPlan(agent.missionId)
  return isMissionTerminalNode(agent.nodeId, plan)
}

/** Deliverable dependsOn sources declared for activations targeting `nodeId`. */
export function dependsOnDeliverableNodes(plan: Pick<OrchestrationPlan, "steps">, nodeId: string) {
  const sources = new Set<string>()
  for (const activation of listPlanRunActivations(plan)) {
    if (activation.targetNodeId !== nodeId) continue
    for (const dep of activation.dependsOn) {
      if (dep.deliverable && dep.node !== nodeId) sources.add(dep.node)
    }
  }
  return [...sources]
}

export function planChildNodeIds(plan: Pick<OrchestrationPlan, "steps">, nodeId: string) {
  return dependsOnDeliverableNodes(plan, nodeId)
}

export function dependsOnDeliverableDescendantNodeIds(plan: Pick<OrchestrationPlan, "steps">, nodeId: string) {
  const ids = new Set<string>([nodeId])
  const queue = [nodeId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const source of dependsOnDeliverableNodes(plan, current)) {
      if (ids.has(source)) continue
      ids.add(source)
      queue.push(source)
    }
  }
  return [...ids]
}

/** Nodes that wait on upstream deliverables via dependsOn (acceptance / synthesis layer). */
export function acceptanceLayerNodeIds(plan: Pick<OrchestrationPlan, "steps">) {
  const ids = new Set<string>()
  for (const activation of listPlanRunActivations(plan)) {
    if (activation.dependsOn.some((dep) => dep.deliverable)) ids.add(activation.targetNodeId)
  }
  return ids
}

export function planLeafNodeIds(team: MissionTeamSpec, plan: Pick<OrchestrationPlan, "steps">) {
  const acceptanceLayer = acceptanceLayerNodeIds(plan)
  return Object.keys(team.nodes).filter((nodeId) => nodeId !== team.terminal && !acceptanceLayer.has(nodeId))
}

export function listPlanExecutionTracks(plan: OrchestrationPlan): PlanExecutionTrack[] {
  const tracks: PlanExecutionTrack[] = []
  let mainTrack: string[] = []

  for (const step of plan.steps) {
    if (step.op === "parallel") {
      if (mainTrack.length > 0) {
        tracks.push({ trackId: mainTrack[0]!, nodeIds: [...mainTrack] })
        mainTrack = []
      }
      for (const trackSource of extractParallelTrackBodies(step.statement) ?? []) {
        const nodeIds = extractTopLevelAwaitStatements(extractAsyncArrowBody(trackSource))
          .map((statement) => extractRunTargetFromStatement(statement))
          .filter((nodeId): nodeId is string => Boolean(nodeId))
        if (nodeIds.length > 0) tracks.push({ trackId: nodeIds[0]!, nodeIds })
      }
      continue
    }
    if (step.op === "run") {
      const nodeId = step.nodeId ?? extractRunTargetFromStatement(step.statement)
      if (nodeId) mainTrack.push(nodeId)
    }
  }

  if (mainTrack.length > 0) tracks.push({ trackId: mainTrack[0]!, nodeIds: [...mainTrack] })
  return tracks
}

/** Parallel track id for lint; null for terminal node. */
export function planTrackForNode(plan: OrchestrationPlan, team: MissionTeamSpec, nodeId: string): string | null {
  if (nodeId === team.terminal) return null

  for (const track of listPlanExecutionTracks(plan)) {
    if (track.nodeIds.includes(nodeId)) return track.trackId
  }

  for (const activation of listPlanRunActivations(plan)) {
    for (const dep of activation.dependsOn) {
      if (dep.deliverable && dep.node === nodeId) return activation.targetNodeId
    }
  }

  if (dependsOnDeliverableNodes(plan, nodeId).length > 0) return nodeId
  return nodeId
}

export function teamNodeOrder(team: MissionTeamSpec, plan?: OrchestrationPlan) {
  const nodeIds = Object.keys(team.nodes)
  if (!plan) return [team.terminal, ...nodeIds.filter((nodeId) => nodeId !== team.terminal).sort()]

  const ordered: string[] = []
  const seen = new Set<string>()
  for (const activation of listPlanRunActivations(plan)) {
    if (seen.has(activation.targetNodeId) || !team.nodes[activation.targetNodeId]) continue
    seen.add(activation.targetNodeId)
    ordered.push(activation.targetNodeId)
  }
  for (const nodeId of nodeIds) {
    if (!seen.has(nodeId)) ordered.push(nodeId)
  }
  return ordered
}

export function planDeliverableDescendantNodeIds(plan: Pick<OrchestrationPlan, "steps">, nodeId: string) {
  return dependsOnDeliverableDescendantNodeIds(plan, nodeId).filter((id) => id !== nodeId)
}

export function innerNodeShowsMissionContract(
  team: MissionTeamSpec,
  nodeId: string,
  plan: Pick<OrchestrationPlan, "steps">,
) {
  if (nodeId === team.terminal) return true
  return dependsOnDeliverableNodes(plan, nodeId).length > 0
}
