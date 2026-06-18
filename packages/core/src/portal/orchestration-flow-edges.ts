import type { PlanStep, PlanStepOp } from "../orchestration/plan-types.ts"
import {
  extractDependsOnFromStatement,
  hasSummaryDepends,
} from "../orchestration/depends-on.ts"
import { parenBraceDepthBefore } from "../orchestration/source-depth.ts"

export type PortalOrchestrationFlowEdge = {
  step_id: string
  from: string
  to: string
  op: PlanStepOp
  state: "done" | "current" | "pending"
  kind?: "activate" | "rollup" | "serial" | "depends"
}

function extractRunTargetIds(statement: string) {
  const singleMatch = /ctx\.run\s*\(\s*["'`]([^"'`]+)["'`]/.exec(statement.trim())
  return singleMatch?.[1] ? [singleMatch[1]] : []
}

function findCallEnd(source: string, openParenIndex: number) {
  let depth = 0
  let inString: '"' | "'" | "`" | null = null
  let escape = false
  for (let i = openParenIndex; i < source.length; i += 1) {
    const ch = source[i]!
    if (escape) {
      escape = false
      continue
    }
    if (inString) {
      if (ch === "\\") escape = true
      else if (ch === inString) inString = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch
      continue
    }
    if (ch === "(") depth += 1
    else if (ch === ")") {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return source.length
}

function findMatchingBracket(source: string, openBracketIndex: number) {
  let depth = 0
  let inString: '"' | "'" | "`" | null = null
  let escape = false
  for (let i = openBracketIndex; i < source.length; i += 1) {
    const ch = source[i]!
    if (escape) {
      escape = false
      continue
    }
    if (inString) {
      if (ch === "\\") escape = true
      else if (ch === inString) inString = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch
      continue
    }
    if (ch === "[") depth += 1
    else if (ch === "]") {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return source.length
}

function findMatchingBrace(source: string, openBraceIndex: number) {
  let depth = 0
  let inString: '"' | "'" | "`" | null = null
  let escape = false
  for (let i = openBraceIndex; i < source.length; i += 1) {
    const ch = source[i]!
    if (escape) {
      escape = false
      continue
    }
    if (inString) {
      if (ch === "\\") escape = true
      else if (ch === inString) inString = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch
      continue
    }
    if (ch === "{") depth += 1
    else if (ch === "}") {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return source.length
}

function splitTopLevelCommaList(body: string) {
  const items: string[] = []
  let start = 0
  let depth = 0
  let inString: '"' | "'" | "`" | null = null
  let escape = false

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!
    if (escape) {
      escape = false
      continue
    }
    if (inString) {
      if (ch === "\\") escape = true
      else if (ch === inString) inString = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch
      continue
    }
    if (ch === "(" || ch === "{" || ch === "[") depth += 1
    else if (ch === ")" || ch === "}" || ch === "]") depth -= 1
    else if (ch === "," && depth === 0) {
      const chunk = body.slice(start, i).trim()
      if (chunk) items.push(chunk)
      start = i + 1
    }
  }

  const last = body.slice(start).trim()
  if (last) items.push(last)
  return items
}

/** Split a fork array into per-track source chunks (each async arrow callback). */
function extractForkTrackBodies(statement: string) {
  const forkMatch = /\bctx\.fork\s*\(/.exec(statement)
  if (!forkMatch) return null

  const openParenIndex = statement.indexOf("(", forkMatch.index)
  if (openParenIndex < 0) return null

  const closeParenIndex = findCallEnd(statement, openParenIndex)
  const forkArgs = statement.slice(openParenIndex + 1, closeParenIndex).trim()
  const openBracketIndex = forkArgs.indexOf("[")
  if (openBracketIndex < 0) return null

  const closeBracketIndex = findMatchingBracket(forkArgs, openBracketIndex)
  const arrayBody = forkArgs.slice(openBracketIndex + 1, closeBracketIndex)
  return splitTopLevelCommaList(arrayBody)
}

function extractAsyncArrowBody(trackSource: string) {
  const arrowBodyMatch = /=>\s*\{/.exec(trackSource)
  if (!arrowBodyMatch) return trackSource.trim()

  const openBraceIndex = trackSource.indexOf("{", arrowBodyMatch.index)
  if (openBraceIndex < 0) return trackSource.trim()

  const closeBraceIndex = findMatchingBrace(trackSource, openBraceIndex)
  return trackSource.slice(openBraceIndex + 1, closeBraceIndex).trim()
}

function extractTopLevelAwaitStatements(source: string) {
  const trimmed = source.trim()
  const boundaryPattern = /\bawait\s+ctx\.(?:run|fork)\s*\(/gm
  const starts: number[] = []
  let match: RegExpExecArray | null
  while ((match = boundaryPattern.exec(trimmed)) !== null) {
    if (parenBraceDepthBefore(trimmed, match.index) === 0) {
      starts.push(match.index)
    }
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

function areSiblingNodes(
  from: string,
  to: string,
  parentByNode: Map<string, string | null>,
) {
  const fromParent = parentByNode.get(from)
  const toParent = parentByNode.get(to)
  return fromParent != null && fromParent === toParent && from !== to
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

function wasSummaryDependsStatement(statement: string, nodeId?: string) {
  const targets = nodeId ? [nodeId] : extractRunTargetIds(statement)
  const dependsOn = extractDependsOnFromStatement(statement)
  return hasSummaryDepends(dependsOn) && targets.length === 1
}

function buildRunStatementEdges(
  statement: string,
  stepId: string,
  state: PortalOrchestrationFlowEdge["state"],
  parentByNode: Map<string, string | null>,
  rootNode: string,
  nodeId?: string,
  prevPrimaryNode?: string,
  prevStatement?: string,
): RunStatementEdgeResult {
  const targets = nodeId ? [nodeId] : extractRunTargetIds(statement)
  const dependsOn = extractDependsOnFromStatement(statement)
  const summaryDeps = dependsOn.filter((dep) => dep.summary)
  const orderDeps = dependsOn.filter((dep) => !dep.summary)
  const stepEdges: PortalOrchestrationFlowEdge[] = []

  if (summaryDeps.length > 0 && targets.length === 1 && orderDeps.length === 0) {
    const to = targets[0]!
    for (const dep of summaryDeps) {
      if (dep.node !== to) {
        stepEdges.push({ step_id: stepId, from: dep.node, to, op: "run", state, kind: "rollup" })
      }
    }
  } else {
    for (const target of targets) {
      const parent = parentByNode.get(target) ?? rootNode
      if (parent && parent !== target) {
        stepEdges.push({ step_id: stepId, from: parent, to: target, op: "run", state, kind: "activate" })
      }
    }
  }

  if (dependsOn.length > 0 && targets.length === 1) {
    const to = targets[0]!
    for (const dep of dependsOn) {
      if (dep.node === to) continue
      const kind = dep.summary ? "rollup" : "depends"
      const exists = stepEdges.some((edge) => edge.from === dep.node && edge.to === to)
      if (!exists) {
        stepEdges.push({ step_id: stepId, from: dep.node, to, op: "run", state, kind })
      }
    }
  }

  const primaryNode = primaryNodeForTargets(nodeId, statement)

  if (
    targets.length === 1 &&
    primaryNode &&
    prevPrimaryNode &&
    prevStatement &&
    !wasSummaryDependsStatement(prevStatement) &&
    areSiblingNodes(prevPrimaryNode, primaryNode, parentByNode)
  ) {
    const exists = stepEdges.some(
      (edge) => edge.from === prevPrimaryNode && edge.to === primaryNode,
    )
    if (!exists) {
      stepEdges.push({
        step_id: stepId,
        from: prevPrimaryNode,
        to: primaryNode,
        op: "run",
        state,
        kind: "serial",
      })
    }
  }

  if (stepEdges.length === 0 && prevPrimaryNode && targets.length === 1) {
    const target = targets[0]
    if (target && prevPrimaryNode !== target) {
      stepEdges.push({
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
  parentByNode: Map<string, string | null>,
  rootNode: string,
) {
  const edges: PortalOrchestrationFlowEdge[] = []
  let prevPrimaryNode: string | undefined
  let prevStatement: string | undefined

  for (const innerStatement of extractTopLevelAwaitStatements(scope)) {
    if (/^await\s+ctx\.fork\s*\(/m.test(innerStatement)) {
      edges.push(
        ...buildForkStatementEdges(innerStatement, stepId, state, parentByNode, rootNode),
      )
      prevPrimaryNode = undefined
      prevStatement = undefined
      continue
    }

    if (/^await\s+ctx\.run\s*\(/m.test(innerStatement)) {
      const result = buildRunStatementEdges(
        innerStatement,
        stepId,
        state,
        parentByNode,
        rootNode,
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

function buildForkStatementEdges(
  statement: string,
  stepId: string,
  state: PortalOrchestrationFlowEdge["state"],
  parentByNode: Map<string, string | null>,
  rootNode: string,
) {
  const tracks = extractForkTrackBodies(statement)
  if (!tracks) {
    return buildStatementSequenceEdges(statement, stepId, state, parentByNode, rootNode)
  }

  const edges: PortalOrchestrationFlowEdge[] = []
  for (const track of tracks) {
    edges.push(
      ...buildStatementSequenceEdges(
        extractAsyncArrowBody(track),
        stepId,
        state,
        parentByNode,
        rootNode,
      ),
    )
  }
  return edges
}

export function buildPortalOrchestrationFlowEdges(
  planSteps: PlanStep[],
  stepStates: PortalOrchestrationFlowEdge["state"][],
  parentByNode: Map<string, string | null>,
  rootNode: string,
): PortalOrchestrationFlowEdge[] {
  const edges: PortalOrchestrationFlowEdge[] = []

  for (const [i, step] of planSteps.entries()) {
    const state = stepStates[i] ?? "pending"
    const prevStep = i > 0 ? planSteps[i - 1] : undefined
    const prevPrimaryNode = prevStep ? primaryNodeForStep(prevStep) : undefined
    const prevStatement =
      prevStep?.op === "run" || prevStep?.op === "fork" ? prevStep.statement : undefined

    if (step.op === "run") {
      const result = buildRunStatementEdges(
        step.statement,
        step.id,
        state,
        parentByNode,
        rootNode,
        step.nodeId,
        prevPrimaryNode,
        prevStatement,
      )
      edges.push(...result.edges)
      continue
    }

    if (step.op === "fork") {
      edges.push(
        ...buildForkStatementEdges(step.statement, step.id, state, parentByNode, rootNode),
      )
    }
  }

  return edges
}
