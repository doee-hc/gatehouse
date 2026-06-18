import { extractDependsOnFromStatement, type NormalizedDependsOn } from "./depends-on.ts"
import type { OrchestrationPlan } from "./plan-types.ts"
import { RegistryDatabase } from "../registry/db.ts"
import type { RegistryAgent } from "../registry/types.ts"

export type PlanRunActivation = {
  targetNodeId: string
  dependsOn: NormalizedDependsOn[]
}

function extractRunTargetFromStatement(statement: string) {
  const match = /ctx\.run\s*\(\s*["'`]([^"'`]+)["'`]/.exec(statement.trim())
  return match?.[1]
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

/** Ordered run activations from a compiled plan (includes nested fork tracks). */
export function listPlanRunActivations(plan: OrchestrationPlan): PlanRunActivation[] {
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
    if (step.op === "fork") {
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
