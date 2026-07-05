import type { GatehouseLocale } from "../locale.ts"
import { planChildNodeIds, planLeafNodeIds } from "./plan-graph.ts"
import type { TeamSpec } from "../tree/types.ts"
import { MissionScriptParseError } from "./script-parse.ts"
import type { ParsedMissionScript } from "./script-parse.ts"
import type { OrchestrationPlan } from "./plan-types.ts"
import {
  initOrchestrationState,
  markNodeRunning,
  orchestrationAllDone,
  orchestrationProblemNodeIds,
} from "./state.ts"
import type { MissionContext, OrchestrationEngine, OrchestrationState } from "./types.ts"
import {
  formatReworkResumeTextWithLocale,
  formatReworkTextWithLocale,
  formatWorkOrderTextWithLocale,
} from "./templates.ts"
import { orchestrationRun } from "./run.ts"
import { orchestrationParallel } from "./primitives.ts"
import { orchestrationPipeline } from "./primitives.ts"
import { mockStructuredFromSchema } from "./json-schema-validate.ts"

export const ORCHESTRATION_SIMULATION_TIMEOUT_MS = 5_000
export const ORCHESTRATION_SIMULATION_MAX_STEPS = 500

export type SimulateOrchestrationResult =
  | { ok: true; warnings: string[] }
  | { ok: false; code: string; message: string }

function markNodeDone(state: OrchestrationState, nodeId: string) {
  const now = new Date().toISOString()
  const current = state.nodes[nodeId] ?? { status: "pending" as const }
  state.nodes[nodeId] = {
    ...current,
    status: "done",
    completed_at: now,
    blocked_by: undefined,
    rework_reason: undefined,
  }
}

function bumpStep(stepCount: { value: number }, maxSteps: number) {
  stepCount.value += 1
  if (stepCount.value > maxSteps) {
    throw new MissionScriptParseError(
      "SCRIPT_SIMULATION_STEP_LIMIT",
      `orchestrate simulation exceeded ${maxSteps} ctx operations (possible infinite loop)`,
    )
  }
}

function createSimulatedMissionContext(input: {
  missionId: string
  locale: GatehouseLocale
  team: TeamSpec
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

  const engine: OrchestrationEngine = {
    async prompt(nodeIds, promptInput) {
      bumpStep(input.stepCount, input.maxSteps)
      const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds]
      for (const nodeId of ids) {
        if (!team.nodes[nodeId]) {
          throw new MissionScriptParseError(
            "SCRIPT_UNKNOWN_NODE",
            `orchestrate references unknown node_id: ${nodeId}`,
          )
        }
        if (!input.briefedNodes.has(nodeId)) {
          throw new MissionScriptParseError(
            "SCRIPT_MISSING_BRIEF",
            `orchestrate run dispatches node "${nodeId}" but never provides brief in ctx.run`,
          )
        }
        if (promptInput.reply) {
          if (!promptInput.text?.trim()) {
            throw new MissionScriptParseError(
              "SCRIPT_SIMULATION_RUNTIME_ERROR",
              `run requires non-empty text for node ${nodeId}`,
            )
          }
          input.dispatchedReply.add(nodeId)
          markNodeRunning(state, nodeId)
        }
      }
    },

    async setBrief(nodeId, partial) {
      bumpStep(input.stepCount, input.maxSteps)
      if (!team.nodes[nodeId]) {
        throw new MissionScriptParseError(
          "SCRIPT_UNKNOWN_NODE",
          `orchestrate references unknown node_id: ${nodeId}`,
        )
      }
      input.briefedNodes.add(nodeId)
      if (partial.completion_schema) {
        input.briefSchemas.set(nodeId, partial.completion_schema)
      }
    },

    async waitFor(nodeId) {
      bumpStep(input.stepCount, input.maxSteps)
      if (!team.nodes[nodeId]) {
        throw new MissionScriptParseError(
          "SCRIPT_UNKNOWN_NODE",
          `orchestrate references unknown node_id: ${nodeId}`,
        )
      }
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

  const defaultWorkOrder = (nodeId: string) =>
    formatWorkOrderTextWithLocale(locale, {
      missionId,
      nodeId,
    })

  return {
    objective: input.objective,

    async run(nodeId, opts) {
      bumpStep(input.stepCount, input.maxSteps)
      await orchestrationRun(engine, nodeId, opts, { defaultWorkOrder })
    },

    async parallel(tracks) {
      bumpStep(input.stepCount, input.maxSteps)
      return orchestrationParallel(tracks)
    },

    async pipeline(items, firstStage, ...restStages) {
      bumpStep(input.stepCount, input.maxSteps)
      return orchestrationPipeline(items, firstStage, ...restStages)
    },

    readMissionContext() {
      throw new MissionScriptParseError(
        "SCRIPT_FORBIDDEN_CTX_READ",
        "readMissionContext() is not available in orchestration sandbox; inline static context in run brief or work-order text",
      )
    },

    readContract() {
      throw new MissionScriptParseError(
        "SCRIPT_FORBIDDEN_CTX_READ",
        "readContract() is not available in orchestration sandbox; inline static context in run brief or work-order text",
      )
    },

    nodeIds() {
      return Object.keys(team.nodes)
    },

    leaves() {
      return planLeafNodeIds(team, plan)
    },

    children(nodeId) {
      return planChildNodeIds(plan, nodeId)
    },

    template: {
      workOrder(nodeId, opts) {
        return formatWorkOrderTextWithLocale(locale, {
          missionId,
          nodeId,
          ...(opts?.context && { context: opts.context }),
          ...(opts?.note && { note: opts.note }),
          ...(opts?.wave !== undefined && { wave: opts.wave }),
        })
      },
      rework(nodeId, reworkInput) {
        return formatReworkTextWithLocale(locale, {
          missionId,
          nodeId,
          requester: reworkInput.requester,
          reason: reworkInput.reason,
          ...(reworkInput.evidence && { evidence: reworkInput.evidence }),
        })
      },
      reworkResume(nodeId, resumeInput) {
        return formatReworkResumeTextWithLocale(locale, {
          missionId,
          nodeId,
          blocker: resumeInput.blocker,
          ...(resumeInput.reason && { reason: resumeInput.reason }),
        })
      },
    },
  }
}

async function runOrchestrateSource(orchestrateSource: string, ctx: MissionContext) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => (ctx: MissionContext) => Promise<void>
  const orchestrate = new AsyncFunction("ctx", orchestrateSource)
  await orchestrate(ctx)
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
