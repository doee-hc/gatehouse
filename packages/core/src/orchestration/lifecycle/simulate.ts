import type { GatehouseLocale } from "../../locale.ts"
import type { MissionTeamSpec } from "../../missions/manifest/types.ts"
import { MissionScriptParseError } from "../script/parse.ts"
import type { ParsedMissionScript } from "../script/parse.ts"
import type { OrchestrationPlan } from "../plan/types.ts"
import {
  initOrchestrationState,
  markNodeRunning,
  orchestrationAllDone,
  orchestrationProblemNodeIds,
} from "../state/store.ts"
import type { MissionContext, OrchestrationEngine, OrchestrationState } from "../types.ts"
import { createWorkOrderTextFactory } from "../engine/templates.ts"
import { mockStructuredFromSchema } from "../script/json-schema-validate.ts"
import { buildMissionContext, runOrchestrateSource } from "../sandbox/mission-ctx-shell.ts"

export const ORCHESTRATION_SIMULATION_TIMEOUT_MS = 5_000
export const ORCHESTRATION_SIMULATION_MAX_STEPS = 500

export type SimulateOrchestrationResult =
  | { ok: true; warnings: string[] }
  | { ok: false; code: string; message: string }

function bumpStep(stepCount: { value: number }, maxSteps: number) {
  stepCount.value += 1
  if (stepCount.value > maxSteps) {
    throw new MissionScriptParseError(
      "SCRIPT_SIMULATION_STEP_LIMIT",
      `orchestrate simulation exceeded ${maxSteps} ctx operations (possible infinite loop)`,
    )
  }
}

function forbiddenCtxRead(method: string): never {
  throw new MissionScriptParseError(
    "SCRIPT_FORBIDDEN_CTX_READ",
    `${method}() is not available in orchestration sandbox; inline static context in run brief or text`,
  )
}

function createSimulatedMissionContext(input: {
  missionId: string
  locale: GatehouseLocale
  team: MissionTeamSpec
  plan: OrchestrationPlan
  objective: string
  state: OrchestrationState
  dispatchedReply: Set<string>
  briefedNodes: Set<string>
  briefSchemas: Map<string, Record<string, unknown>>
  stepCount: { value: number }
  maxSteps: number
}): MissionContext {
  const { missionId, locale, team, plan, state } = input

  function completeSimulatedNode(nodeId: string) {
    const now = new Date().toISOString()
    const schema = input.briefSchemas.get(nodeId)
    const structured = schema ? mockStructuredFromSchema(schema) : undefined
    const current = state.nodes[nodeId] ?? { status: "pending" as const }
    state.nodes[nodeId] = {
      ...current,
      status: "done",
      completed_at: now,
      blocked_by: undefined,
      rework_reason: undefined,
      completion: {
        summary: `simulated completion for ${nodeId}`,
        completed_at: now,
        ...(structured !== undefined && { structured_output: structured }),
      },
    }
  }

  function assertKnownNode(nodeId: string) {
    if (!team.nodes[nodeId]) {
      throw new MissionScriptParseError(
        "SCRIPT_UNKNOWN_NODE",
        `orchestrate references unknown node_id: ${nodeId}`,
      )
    }
  }

  const engine: OrchestrationEngine = {
    async prompt(nodeIds, promptInput) {
      bumpStep(input.stepCount, input.maxSteps)
      const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds]
      for (const nodeId of ids) {
        assertKnownNode(nodeId)
        if (!input.briefedNodes.has(nodeId)) {
          throw new MissionScriptParseError(
            "SCRIPT_MISSING_BRIEF",
            `orchestrate run dispatches node "${nodeId}" but never provides brief in ctx.run`,
          )
        }
        if (promptInput.reply) {
          input.dispatchedReply.add(nodeId)
          markNodeRunning(state, nodeId)
        }
      }
    },

    async setBrief(nodeId, partial) {
      bumpStep(input.stepCount, input.maxSteps)
      assertKnownNode(nodeId)
      input.briefedNodes.add(nodeId)
      if (partial.completion_schema) {
        input.briefSchemas.set(nodeId, partial.completion_schema)
      }
    },

    async waitFor(nodeId) {
      bumpStep(input.stepCount, input.maxSteps)
      assertKnownNode(nodeId)
      if (state.nodes[nodeId]?.status === "done") {
        return { completion: state.nodes[nodeId]?.completion }
      }
      if (!input.dispatchedReply.has(nodeId)) {
        throw new MissionScriptParseError(
          "SCRIPT_SIMULATION_UNPROMPTED_WAIT",
          `run("${nodeId}") waits before that node was dispatched`,
        )
      }
      completeSimulatedNode(nodeId)
      return { completion: state.nodes[nodeId]?.completion }
    },
  }

  const workOrderText = createWorkOrderTextFactory({ missionId, locale })
  const shell = buildMissionContext({
    objective: input.objective,
    team,
    engine,
    runConfig: { workOrderText },
    resolvePlan: () => plan,
    readMissionContext: () => forbiddenCtxRead("readMissionContext"),
    readContract: () => forbiddenCtxRead("readContract"),
  })

  return {
    ...shell,
    async run(nodeId, opts) {
      bumpStep(input.stepCount, input.maxSteps)
      await shell.run(nodeId, opts)
    },
    async parallel(tracks) {
      bumpStep(input.stepCount, input.maxSteps)
      return shell.parallel(tracks)
    },
    async pipeline(items, firstStage, ...restStages) {
      bumpStep(input.stepCount, input.maxSteps)
      return shell.pipeline(items, firstStage, ...restStages)
    },
  }
}

function incompleteSimulationMessage(state: OrchestrationState) {
  const pending = Object.entries(state.nodes)
    .filter(([, node]) => node.status === "pending")
    .map(([nodeId]) => nodeId)
  const active = orchestrationProblemNodeIds(state)
  const blocked = Object.entries(state.nodes)
    .filter(([, node]) => node.status === "blocked")
    .map(([nodeId]) => nodeId)
  const parts: string[] = []
  if (pending.length > 0) parts.push(`pending: ${pending.join(", ")}`)
  if (active.length > 0) parts.push(`still active: ${active.join(", ")}`)
  if (blocked.length > 0) parts.push(`blocked: ${blocked.join(", ")}`)
  return parts.join("; ")
}

export async function simulateOrchestration(input: {
  parsed: ParsedMissionScript
  plan: OrchestrationPlan
  locale?: GatehouseLocale
  objective?: string
}): Promise<SimulateOrchestrationResult> {
  const orchestrateSource = input.parsed.orchestrateSource
  if (!orchestrateSource?.trim()) {
    return {
      ok: false,
      code: "SCRIPT_MISSING_ORCHESTRATE",
      message: "mission.script.ts must export default async function orchestrate(ctx)",
    }
  }

  const locale = input.locale ?? "en"
  const team = input.parsed.team
  const missionId = team.mission_id
  const state = initOrchestrationState(missionId, Object.keys(team.nodes))
  const dispatchedReply = new Set<string>()
  const briefedNodes = new Set<string>()
  const briefSchemas = new Map<string, Record<string, unknown>>()
  const stepCount = { value: 0 }
  const maxSteps = Math.max(ORCHESTRATION_SIMULATION_MAX_STEPS, input.plan.steps.length * 10)

  const ctx = createSimulatedMissionContext({
    missionId,
    locale,
    team,
    plan: input.plan,
    objective: input.objective ?? "simulation",
    state,
    dispatchedReply,
    briefedNodes,
    briefSchemas,
    stepCount,
    maxSteps,
  })

  try {
    await Promise.race([
      runOrchestrateSource(orchestrateSource, ctx),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new MissionScriptParseError(
              "SCRIPT_SIMULATION_TIMEOUT",
              `orchestrate simulation timed out after ${ORCHESTRATION_SIMULATION_TIMEOUT_MS}ms`,
            ),
          )
        }, ORCHESTRATION_SIMULATION_TIMEOUT_MS)
      }),
    ])
  } catch (error) {
    if (error instanceof MissionScriptParseError) {
      return { ok: false, code: error.code, message: error.message }
    }
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      code: "SCRIPT_SIMULATION_RUNTIME_ERROR",
      message: `orchestrate simulation failed: ${message}`,
    }
  }

  if (!orchestrationAllDone(state)) {
    return {
      ok: false,
      code: "SCRIPT_SIMULATION_INCOMPLETE",
      message:
        `orchestrate simulation finished but mission is incomplete (${incompleteSimulationMessage(state)}). ` +
        "Every team node must reach done via ctx.run.",
    }
  }

  return { ok: true, warnings: [...input.plan.warnings] }
}
