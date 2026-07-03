import { createHash } from "node:crypto"
import type { TeamSpec } from "../tree/types.ts"
import { MissionScriptParseError } from "./script-parse.ts"
import { parenBraceDepthBefore } from "./source-depth.ts"
import { inferTerminalNodeFromPlan } from "./plan-graph.ts"
import {
  hashPlanVersion,
  ORCHESTRATION_PLAN_SCHEMA_VERSION,
  type OrchestrationPlan,
  type PlanStep,
  type PlanStepOp,
} from "./plan-types.ts"

/** Strip trailing // comment lines so sandbox per-step replay does not comment-out the wrapper close. */
export function trimPlanStatementChunk(chunk: string) {
  let trimmed = chunk.trimEnd()
  while (/(\n|^)[ \t]*\/\/[^\n]*$/.test(trimmed)) {
    trimmed = trimmed.replace(/(\n|^)[ \t]*\/\/[^\n]*$/, "").trimEnd()
  }
  return trimmed.trim()
}

/** Split orchestrate body into top-level await ctx.run/fork statements. */
export function splitOrchestrateStatements(orchestrateSource: string) {
  const statements: string[] = []
  const trimmed = orchestrateSource.trim()
  if (!trimmed) return statements

  const boundaryPattern = /\bawait\s+ctx\.(?:run|fork)\s*\(/gm
  let match: RegExpExecArray | null
  const starts: number[] = []
  while ((match = boundaryPattern.exec(trimmed)) !== null) {
    if (parenBraceDepthBefore(trimmed, match.index) === 0) {
      starts.push(match.index)
    }
  }

  if (starts.length === 0) {
    throw new MissionScriptParseError(
      "SCRIPT_EMPTY_PLAN",
      "orchestrate body has no await ctx.run/fork steps",
    )
  }

  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i]!
    const end = i + 1 < starts.length ? starts[i + 1]! : trimmed.length
    const chunk = trimPlanStatementChunk(trimmed.slice(start, end))
    if (chunk) statements.push(chunk)
  }

  return statements
}

function extractNodeIdFromCall(statement: string, method: string) {
  const pattern = new RegExp(`ctx\\.${method}\\s*\\(\\s*["'\`]([^"'\`]+)["'\`]`)
  return pattern.exec(statement)?.[1]
}

function classifyStatement(statement: string, team: TeamSpec): PlanStep {
  const trimmed = statement.trim()
  let op: PlanStepOp = "other"
  let nodeId: string | undefined

  if (/^await\s+ctx\.run\s*\(/.test(trimmed)) {
    op = "run"
    nodeId = extractNodeIdFromCall(trimmed, "run")
  } else if (/^await\s+ctx\.fork\s*\(/.test(trimmed)) {
    op = "fork"
  }

  if (nodeId && !team.nodes[nodeId]) {
    throw new MissionScriptParseError("SCRIPT_UNKNOWN_NODE", `plan step references unknown node_id: ${nodeId}`)
  }

  return {
    id: "",
    op,
    statement: trimmed,
    ...(nodeId && { nodeId }),
  }
}

function validateTeamGraph(team: TeamSpec) {
  if (!team.nodes[team.terminal]) {
    throw new MissionScriptParseError("SCRIPT_INVALID_TEAM", `team.terminal ${team.terminal} is not in nodes`)
  }
}

function validateWaitSequence(steps: PlanStep[]) {
  const dispatched = new Set<string>()
  const dispatchCounts = new Map<string, number>()
  const warnings: string[] = []

  for (const step of steps) {
    if (step.op === "run" && step.nodeId) {
      dispatched.add(step.nodeId)
      dispatchCounts.set(step.nodeId, (dispatchCounts.get(step.nodeId) ?? 0) + 1)
    }

    if (step.op === "fork") {
      // Compound step; inner order validated by simulation.
    }
  }

  for (const [nodeId, count] of dispatchCounts) {
    if (count > 1) {
      warnings.push(
        `node "${nodeId}" has ${count} run steps; plan-based replay will run each step independently`,
      )
    }
  }

  return warnings
}

export function compileOrchestrationPlan(input: {
  missionId: string
  team: TeamSpec
  orchestrateSource: string
  scriptHash: string
}): OrchestrationPlan {
  validateTeamGraph(input.team)

  const rawStatements = splitOrchestrateStatements(input.orchestrateSource)
  if (rawStatements.length === 0) {
    throw new MissionScriptParseError("SCRIPT_EMPTY_PLAN", "orchestrate body has no await ctx.run/fork steps")
  }

  const steps: PlanStep[] = rawStatements.map((statement, index) => {
    const step = classifyStatement(statement, input.team)
    return { ...step, id: `step-${index}` }
  })

  const warnings = validateWaitSequence(steps)

  const plan: OrchestrationPlan = {
    schema_version: ORCHESTRATION_PLAN_SCHEMA_VERSION,
    mission_id: input.missionId,
    script_hash: input.scriptHash,
    plan_version: "",
    steps,
    warnings,
  }
  plan.terminal_node = inferTerminalNodeFromPlan(plan)
  if (plan.terminal_node && input.team.terminal !== plan.terminal_node) {
    throw new MissionScriptParseError(
      "SCRIPT_TERMINAL_MISMATCH",
      `team.terminal (${input.team.terminal}) must equal plan terminal node (${plan.terminal_node})`,
    )
  }
  plan.plan_version = hashPlanVersion(plan)
  return plan
}

export function planVersionFromScript(scriptHash: string, orchestrateSource: string) {
  const statements = splitOrchestrateStatements(orchestrateSource)
  const stepIds = statements.map((_, index) => `step-${index}`).join(",")
  const payload = `${scriptHash}:${stepIds}`
  return createHash("sha256").update(payload).digest("hex").slice(0, 16)
}
