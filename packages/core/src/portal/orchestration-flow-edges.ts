import type { PlanStep, PlanStepOp } from "../orchestration/plan/types.ts"
import {
  extractDependsOnFromStatement,
  hasDeliverableDepends,
} from "../orchestration/engine/depends-on.ts"
import {
  extractAsyncArrowBody,
  extractParallelTrackBodies,
  extractRunTargetIds,
  extractTopLevelAwaitStatements,
} from "../orchestration/script/source-parse.ts"

export type PortalOrchestrationFlowEdge = {
  step_id: string
  from: string
  to: string
  op: PlanStepOp
  state: "done" | "current" | "pending"
  kind?: "deliverable" | "serial" | "depends"
}

function primaryNodeForTargets(nodeId: string | undefined, statement: string) {
  if (nodeId) return nodeId
  const targets = extractRunTargetIds(statement)
  return targets[0]
}

function primaryNodeForStep(step: PlanStep) {
  return primaryNodeForTargets(step.nodeId, step.statement)
}

type RunStatementEdgeResult = {
  edges: PortalOrchestrationFlowEdge[]
  primaryNode?: string
}

export function wasDeliverableDependsStatement(statement: string, nodeId?: string) {
  const targets = nodeId ? [nodeId] : extractRunTargetIds(statement)
  const dependsOn = extractDependsOnFromStatement(statement)
  return hasDeliverableDepends(dependsOn) && targets.length === 1
}

function pushEdge(
  stepEdges: PortalOrchestrationFlowEdge[],
  edge: PortalOrchestrationFlowEdge,
) {
  const exists = stepEdges.some((item) => item.from === edge.from && item.to === edge.to)
  if (!exists) stepEdges.push(edge)
}

function buildRunStatementEdges(
  statement: string,
  stepId: string,
  state: PortalOrchestrationFlowEdge["state"],
  nodeId?: string,
  prevPrimaryNode?: string,
  prevStatement?: string,
): RunStatementEdgeResult {
  const targets = nodeId ? [nodeId] : extractRunTargetIds(statement)
  const dependsOn = extractDependsOnFromStatement(statement)
  const deliverableDeps = dependsOn.filter((dep) => dep.deliverable)
  const orderDeps = dependsOn.filter((dep) => !dep.deliverable)
  const stepEdges: PortalOrchestrationFlowEdge[] = []

  if (deliverableDeps.length > 0 && targets.length === 1 && orderDeps.length === 0) {
    const to = targets[0]!
    for (const dep of deliverableDeps) {
      if (dep.node !== to) {
        pushEdge(stepEdges, { step_id: stepId, from: dep.node, to, op: "run", state, kind: "deliverable" })
      }
    }
  }

  if (dependsOn.length > 0 && targets.length === 1) {
    const to = targets[0]!
    for (const dep of dependsOn) {
      if (dep.node === to) continue
      pushEdge(stepEdges, {
        step_id: stepId,
        from: dep.node,
        to,
        op: "run",
        state,
        kind: dep.deliverable ? "deliverable" : "depends",
      })
    }
  }

  const primaryNode = primaryNodeForTargets(nodeId, statement)

  if (
    targets.length === 1 &&
    primaryNode &&
    prevPrimaryNode &&
    prevStatement &&
    !wasDeliverableDependsStatement(prevStatement) &&
    prevPrimaryNode !== primaryNode
  ) {
    pushEdge(stepEdges, {
      step_id: stepId,
      from: prevPrimaryNode,
      to: primaryNode,
      op: "run",
      state,
      kind: "serial",
    })
  }

  if (stepEdges.length === 0 && prevPrimaryNode && targets.length === 1) {
    const target = targets[0]
    if (target && prevPrimaryNode !== target) {
      pushEdge(stepEdges, {
        step_id: stepId,
        from: prevPrimaryNode,
        to: target,
        op: "run",
        state,
        kind: "serial",
      })
    }
  }

  return {
    edges: stepEdges,
    ...(primaryNode && { primaryNode }),
  }
}

function buildStatementSequenceEdges(
  scope: string,
  stepId: string,
  state: PortalOrchestrationFlowEdge["state"],
) {
  const edges: PortalOrchestrationFlowEdge[] = []
  let prevPrimaryNode: string | undefined
  let prevStatement: string | undefined

  for (const innerStatement of extractTopLevelAwaitStatements(scope)) {
    if (/^await\s+ctx\.parallel\s*\(/m.test(innerStatement)) {
      edges.push(...buildParallelStatementEdges(innerStatement, stepId, state))
      prevPrimaryNode = undefined
      prevStatement = undefined
      continue
    }

    if (/^await\s+ctx\.run\s*\(/m.test(innerStatement)) {
      const result = buildRunStatementEdges(
        innerStatement,
        stepId,
        state,
        undefined,
        prevPrimaryNode,
        prevStatement,
      )
      edges.push(...result.edges)
      if (result.primaryNode) prevPrimaryNode = result.primaryNode
      prevStatement = innerStatement
    }
  }

  return edges
}

function buildParallelStatementEdges(
  statement: string,
  stepId: string,
  state: PortalOrchestrationFlowEdge["state"],
) {
  const tracks = extractParallelTrackBodies(statement)
  if (!tracks) {
    return buildStatementSequenceEdges(statement, stepId, state)
  }

  const edges: PortalOrchestrationFlowEdge[] = []
  for (const track of tracks) {
    edges.push(...buildStatementSequenceEdges(extractAsyncArrowBody(track), stepId, state))
  }
  return edges
}

/** Derive directed flow edges from compiled plan steps. */
export function buildPortalOrchestrationFlowEdges(
  planSteps: PlanStep[],
  stepStates: PortalOrchestrationFlowEdge["state"][],
): PortalOrchestrationFlowEdge[] {
  const edges: PortalOrchestrationFlowEdge[] = []

  for (const [i, step] of planSteps.entries()) {
    const state = stepStates[i] ?? "pending"
    const prevStep = i > 0 ? planSteps[i - 1] : undefined
    const prevPrimaryNode = prevStep ? primaryNodeForStep(prevStep) : undefined
    const prevStatement =
      prevStep?.op === "run" || prevStep?.op === "parallel" ? prevStep.statement : undefined
    const prevWasPlainRun =
      prevStep?.op === "run" &&
      Boolean(prevStatement) &&
      !wasDeliverableDependsStatement(prevStatement!, prevStep.nodeId)

    if (step.op === "run") {
      const result = buildRunStatementEdges(
        step.statement,
        step.id,
        state,
        step.nodeId,
        prevWasPlainRun ? prevPrimaryNode : undefined,
        prevWasPlainRun ? prevStatement : undefined,
      )
      edges.push(...result.edges)
      continue
    }

    if (step.op === "parallel") {
      edges.push(...buildParallelStatementEdges(step.statement, step.id, state))
    }
  }

  return edges
}
