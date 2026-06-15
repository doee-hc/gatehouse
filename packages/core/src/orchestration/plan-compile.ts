import { createHash } from "node:crypto"
import { childNodeIdsFromSpec, topologicalNodeOrder } from "../tree/parse.ts"
import type { TeamSpec } from "../tree/types.ts"
import { MissionScriptParseError } from "./script-parse.ts"
import { parenBraceDepthBefore } from "./source-depth.ts"
import {
  hashPlanVersion,
  leafDescendants,
  ORCHESTRATION_PLAN_SCHEMA_VERSION,
  type OrchestrationPlan,
  type PlanStep,
  type PlanStepOp,
} from "./plan-types.ts"

function findCallEnd(source: string, openParenIndex: number) {
  let depth = 0
  for (let i = openParenIndex; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === "(") depth += 1
    else if (ch === ")") {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return source.length
}

/** Strip trailing // comment lines so sandbox per-step replay does not comment-out the wrapper close. */
export function trimPlanStatementChunk(chunk: string) {
  let trimmed = chunk.trimEnd()
  while (/(\n|^)[ \t]*\/\/[^\n]*$/.test(trimmed)) {
    trimmed = trimmed.replace(/(\n|^)[ \t]*\/\/[^\n]*$/, "").trimEnd()
  }
  return trimmed.trim()
}

/** Split orchestrate body into top-level await statements and sync ctx.phase calls. */
export function splitOrchestrateStatements(orchestrateSource: string) {
  const statements: string[] = []
  const trimmed = orchestrateSource.trim()
  if (!trimmed) return statements

  const boundaryPattern =
    /(?:\bawait\s+ctx\.(?:parallel|pipeline)\s*\(|\bawait\s+ctx\.|^\s*ctx\.phase\s*\(|^\s*ctx\.log\s*\()/gm
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
      "orchestrate body has no ctx.* orchestration steps",
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
  let reply: boolean | undefined
  let rootNodeId: string | undefined
  let title: string | undefined

  if (/^await\s+ctx\.setBrief\s*\(/.test(trimmed)) {
    op = "setBrief"
    nodeId = extractNodeIdFromCall(trimmed, "setBrief")
  } else if (/^await\s+ctx\.prompt\s*\(/.test(trimmed)) {
    op = "prompt"
    nodeId = extractNodeIdFromCall(trimmed, "prompt")
    reply = /reply\s*:\s*true/.test(trimmed)
  } else if (/^await\s+ctx\.waitFor\s*\(/.test(trimmed)) {
    op = "wait"
    nodeId = extractNodeIdFromCall(trimmed, "waitFor")
  } else if (/^await\s+ctx\.waitForRollup\s*\(/.test(trimmed)) {
    op = "waitRollup"
    rootNodeId = extractNodeIdFromCall(trimmed, "waitForRollup")
  } else if (/^await\s+ctx\.parallel\s*\(/.test(trimmed)) {
    op = "parallel"
  } else if (/^await\s+ctx\.pipeline\s*\(/.test(trimmed)) {
    op = "pipeline"
  } else if (/^ctx\.phase\s*\(/.test(trimmed) || /^await\s+ctx\.phase\s*\(/.test(trimmed)) {
    op = "phase"
    const titleMatch = /phase\s*\(\s*["'`]([^"'`]+)["'`]/.exec(trimmed)
    title = titleMatch?.[1]
  } else if (/^await\s+ctx\.log\s*\(/.test(trimmed)) {
    op = "log"
  }

  if (nodeId && !team.nodes[nodeId]) {
    throw new MissionScriptParseError("SCRIPT_UNKNOWN_NODE", `plan step references unknown node_id: ${nodeId}`)
  }
  if (rootNodeId && !team.nodes[rootNodeId]) {
    throw new MissionScriptParseError("SCRIPT_UNKNOWN_NODE", `plan step references unknown rootNodeId: ${rootNodeId}`)
  }

  return {
    id: "",
    op,
    statement: trimmed,
    ...(nodeId && { nodeId }),
    ...(reply !== undefined && { reply }),
    ...(rootNodeId && { rootNodeId }),
    ...(title && { title }),
  }
}

function validateTeamGraph(team: TeamSpec) {
  if (!team.nodes[team.root]) {
    throw new MissionScriptParseError("SCRIPT_INVALID_TEAM", `team.root ${team.root} is not in nodes`)
  }
  try {
    topologicalNodeOrder(team)
  } catch {
    throw new MissionScriptParseError("SCRIPT_TEAM_CYCLE", "team.nodes parent graph contains a cycle")
  }

  const reachable = new Set<string>()
  const walk = (nodeId: string) => {
    if (reachable.has(nodeId)) return
    reachable.add(nodeId)
    for (const child of childNodeIdsFromSpec(team, nodeId)) walk(child)
  }
  walk(team.root)

  for (const nodeId of Object.keys(team.nodes)) {
    if (!reachable.has(nodeId)) {
      throw new MissionScriptParseError(
        "SCRIPT_UNREACHABLE_NODE",
        `team node ${nodeId} is not reachable from root ${team.root}`,
      )
    }
  }
}

function validateWaitSequence(steps: PlanStep[]) {
  const promptedReply = new Set<string>()
  const promptReplyCounts = new Map<string, number>()
  const warnings: string[] = []

  for (const step of steps) {
    if (step.op === "prompt" && step.reply && step.nodeId) {
      promptedReply.add(step.nodeId)
      promptReplyCounts.set(step.nodeId, (promptReplyCounts.get(step.nodeId) ?? 0) + 1)
    }

    if (step.op === "wait" && step.nodeId) {
      if (!promptedReply.has(step.nodeId)) {
        throw new MissionScriptParseError(
          "SCRIPT_UNPROMPTED_WAIT",
          `waitFor("${step.nodeId}") appears before prompt(reply:true) for that node`,
        )
      }
    }

    if (step.op === "parallel" || step.op === "pipeline") {
      // Compound steps; inner wait order is validated by orchestrate simulation.
    }

    if (step.op === "waitRollup" && step.rootNodeId) {
      // validated at compile time when team is available in compileOrchestrationPlan
    }
  }

  for (const [nodeId, count] of promptReplyCounts) {
    if (count > 1) {
      warnings.push(
        `node "${nodeId}" has ${count} prompt(reply:true) steps; plan-based replay will run each step independently`,
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
    throw new MissionScriptParseError("SCRIPT_EMPTY_PLAN", "orchestrate body has no await ctx.* steps")
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
  plan.plan_version = hashPlanVersion(plan)
  return plan
}

export function planVersionFromScript(scriptHash: string, orchestrateSource: string) {
  const statements = splitOrchestrateStatements(orchestrateSource)
  const stepIds = statements.map((_, index) => `step-${index}`).join(",")
  const payload = `${scriptHash}:${stepIds}`
  return createHash("sha256").update(payload).digest("hex").slice(0, 16)
}
