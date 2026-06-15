import type { PluginInput } from "@opencode-ai/plugin"
import { gatehouseLog } from "../log.ts"
import type { RegistryStore } from "../registry/store.ts"
import type { TeamSpec } from "../tree/types.ts"
import { childNodeIdsFromSpec } from "../tree/parse.ts"
import { deliverNodeBriefSystemPrompt } from "../execution/node-session.ts"
import { readActiveMissionContract } from "../missions/contract.ts"
import {
  mergeAndSaveBrief,
  readContractForScript,
  readMissionContextForScript,
} from "./events.ts"
import { deliverOrchestrationPrompt } from "./prompt.ts"
import {
  armCompoundReactivation,
  consumeCompoundReactivation,
  isCompoundPlanStepOp,
  shouldSkipCompoundReplyPrompt,
  shouldSkipCompoundSetBriefDeliver,
} from "./compound-replay.ts"
import { readLatestOrchestrationPlanRecord } from "./plan-store.ts"
import type { PlanStep } from "./plan-types.ts"
import {
  isPlanStepCompleted,
  markNodeRunning,
  markPlanStepCompleted,
  mutateOrchestrationState,
  nodeAlreadyActivated,
  nodeIsCompleteForWait,
  readOrchestrationState,
  shouldSkipReplyPromptStep,
} from "./state.ts"
import type { SandboxRpcRequest } from "./sandbox-protocol.ts"
import type { MissionContext, MissionScriptMeta, PromptInput } from "./types.ts"
import { waitForOrchestration } from "./wait.ts"
import {
  formatReworkResumeText,
  formatReworkText,
  formatWorkOrderText,
} from "./templates.ts"
import { orchestrationParallel, orchestrationPipeline } from "./primitives.ts"
import { RegistryDatabase } from "../registry/db.ts"

const PROMPT_TEXT_MAX = 32_768
const MAX_REPLY_PROMPTS_PER_MISSION = 500

export function createMissionHostHandlers(input: {
  plugin: PluginInput
  store: RegistryStore
  team: TeamSpec
  meta?: MissionScriptMeta
}) {
  const missionId = input.team.mission_id
  let replyPromptCount = 0
  let activePlanStep: { id: string; index: number } | undefined
  let activePlanStepMeta: PlanStep | undefined
  let compoundReactivationLatch = new Set<string>()
  let compoundLatchStepId: string | undefined

  const ctx = createMissionContext({
    ...input,
    planStep: () => activePlanStep,
    compoundReplay: () => ({
      active: isCompoundPlanStepOp(activePlanStepMeta?.op),
      latch: compoundReactivationLatch,
    }),
  })

  function syncCompoundLatch(step: PlanStep | undefined) {
    if (!step || !isCompoundPlanStepOp(step.op)) {
      compoundLatchStepId = undefined
      return
    }
    if (compoundLatchStepId !== step.id) {
      compoundLatchStepId = step.id
      compoundReactivationLatch = new Set()
    }
  }

  function resolveActivePlanStepMeta(step: { id: string; index: number } | undefined) {
    if (!step) return undefined
    const plan = readLatestOrchestrationPlanRecord(input.plugin.directory, missionId)
    return plan?.steps[step.index]?.id === step.id ? plan.steps[step.index] : plan?.steps.find((s) => s.id === step.id)
  }

  function finishPlanStep() {
    if (!activePlanStep) return
    const step = activePlanStep
    mutateOrchestrationState(input.plugin.directory, missionId, (state) => {
      markPlanStepCompleted(state, step.id, step.index)
    })
  }

  function finishPlanStepIfAttached(request: SandboxRpcRequest) {
    if (!activePlanStep || !request.markPlanStepComplete) return
    finishPlanStep()
  }

  async function handleRpc(request: SandboxRpcRequest): Promise<unknown> {
    activePlanStep =
      request.stepId && request.stepIndex !== undefined
        ? { id: request.stepId, index: request.stepIndex }
        : undefined
    activePlanStepMeta = resolveActivePlanStepMeta(activePlanStep)
    syncCompoundLatch(activePlanStepMeta)

    try {
      const state = readOrchestrationState(input.plugin.directory, missionId)
      if (activePlanStep && state && isPlanStepCompleted(state, activePlanStep.id)) {
        gatehouseLog(
          "info",
          `[orchestration:${missionId}] skip completed plan step ${activePlanStep.id}`,
        )
        return undefined
      }

      switch (request.op) {
        case "prompt": {
          const nodeIds = request.nodeIds ?? []
          const promptInput = request.input ?? {}
          assertPromptAllowed(input.team, nodeIds, promptInput, replyPromptCount)
          if (promptInput.reply) replyPromptCount += 1
          await ctx.prompt(nodeIds.length === 1 ? nodeIds[0]! : nodeIds, promptInput)
          finishPlanStepIfAttached(request)
          return undefined
        }
        case "setBrief": {
          if (!request.nodeId) throw new Error("setBrief requires nodeId")
          assertNodeInTeam(input.team, request.nodeId)
          await ctx.setBrief(request.nodeId, request.partial ?? {})
          finishPlanStepIfAttached(request)
          return undefined
        }
        case "readMissionContext":
          return ctx.readMissionContext()
        case "readContract":
          return ctx.readContract(request.view ? { view: request.view } : undefined)
        case "waitFor": {
          if (!request.nodeId) throw new Error("waitFor requires nodeId")
          assertNodeInTeam(input.team, request.nodeId)
          await ctx.waitFor(request.nodeId, "complete", request.timeout ? { timeout: request.timeout } : undefined)
          finishPlanStepIfAttached(request)
          return undefined
        }
        case "waitForRollup": {
          if (!request.rootNodeId) throw new Error("waitForRollup requires rootNodeId")
          assertNodeInTeam(input.team, request.rootNodeId)
          await ctx.waitForRollup(request.rootNodeId)
          finishPlanStepIfAttached(request)
          return undefined
        }
        case "planStepComplete": {
          finishPlanStepIfAttached(request)
          return undefined
        }
        case "phase": {
          if (!request.title?.trim()) throw new Error("phase requires title")
          ctx.phase(request.title.slice(0, 128))
          finishPlanStepIfAttached(request)
          return undefined
        }
        case "log":
          ctx.log(request.message ?? "")
          return undefined
        default:
          throw new Error(`unsupported sandbox rpc op: ${(request as SandboxRpcRequest).op}`)
      }
    } finally {
      activePlanStep = undefined
      activePlanStepMeta = undefined
    }
  }

  return { ctx, handleRpc, missionId }
}

function assertNodeInTeam(team: TeamSpec, nodeId: string) {
  if (!team.nodes[nodeId]) {
    throw new Error(`unknown node_id in orchestration script: ${nodeId}`)
  }
}

function assertPromptAllowed(team: TeamSpec, nodeIds: string[], input: PromptInput, replyCount: number) {
  if (nodeIds.length === 0) throw new Error("prompt requires at least one nodeId")
  for (const nodeId of nodeIds) assertNodeInTeam(team, nodeId)
  const rollupFrom = input.rollupFrom?.filter((id) => id.trim()) ?? []
  for (const nodeId of rollupFrom) assertNodeInTeam(team, nodeId)
  const text = input.text ?? ""
  if (text.length > PROMPT_TEXT_MAX) {
    throw new Error(`prompt text exceeds ${PROMPT_TEXT_MAX} bytes`)
  }
  if (input.reply) {
    if (!text.trim()) throw new Error("prompt(reply:true) requires non-empty text")
    if (replyCount >= Math.max(MAX_REPLY_PROMPTS_PER_MISSION, Object.keys(team.nodes).length * 10)) {
      throw new Error("prompt(reply:true) rate limit exceeded for mission")
    }
  }
}

export function createMissionContext(input: {
  plugin: PluginInput
  store: RegistryStore
  team: TeamSpec
  meta?: MissionScriptMeta
  planStep?: () => { id: string; index: number } | undefined
  compoundReplay?: () => { active: boolean; latch: Set<string> }
}): MissionContext {
  const { plugin, store, team } = input
  const missionId = team.mission_id
  const contract = readActiveMissionContract(plugin.directory, missionId)

  const ctx: MissionContext = {
    objective: contract?.objective ?? "",

    async prompt(nodeIds, promptInput) {
      const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds]
      const state = readOrchestrationState(plugin.directory, missionId)
      if (!state) throw new Error(`orchestration state missing for ${missionId}`)
      const planStep = input.planStep?.()
      const compoundReplay = input.compoundReplay?.()

      const toMarkRunning: string[] = []
      const toDeliver: string[] = []

      for (const nodeId of ids) {
        if (promptInput.reply) {
          if (!promptInput.text?.trim()) {
            throw new Error(`prompt(reply:true) requires text for node ${nodeId}`)
          }
          if (planStep) {
            if (shouldSkipReplyPromptStep(state, planStep.id)) {
              gatehouseLog(
                "info",
                `[orchestration:${missionId}] skip plan step ${planStep.id} prompt for ${nodeId}`,
              )
              continue
            }
            if (
              compoundReplay?.active &&
              shouldSkipCompoundReplyPrompt(state, nodeId, compoundReplay.latch)
            ) {
              gatehouseLog(
                "info",
                `[orchestration:${missionId}] skip compound replay prompt for done node ${nodeId}`,
              )
              continue
            }
          } else if (nodeAlreadyActivated(state, nodeId)) {
            gatehouseLog(
              "info",
              `[orchestration:${missionId}] skip re-prompt for ${nodeId} (${state.nodes[nodeId]?.status})`,
            )
            continue
          }
          toMarkRunning.push(nodeId)
        }
        toDeliver.push(nodeId)
      }

      if (toMarkRunning.length > 0) {
        mutateOrchestrationState(plugin.directory, missionId, (fresh) => {
          for (const nodeId of toMarkRunning) {
            if (planStep && shouldSkipReplyPromptStep(fresh, planStep.id)) continue
            if (
              planStep &&
              compoundReplay?.active &&
              shouldSkipCompoundReplyPrompt(fresh, nodeId, compoundReplay.latch)
            ) {
              continue
            }
            if (!planStep && nodeAlreadyActivated(fresh, nodeId)) continue
            markNodeRunning(fresh, nodeId)
          }
        })
      }

      for (const nodeId of toDeliver) {
        if (
          promptInput.reply &&
          planStep &&
          compoundReplay?.active &&
          shouldSkipCompoundReplyPrompt(state, nodeId, compoundReplay.latch)
        ) {
          continue
        }
        await deliverOrchestrationPrompt({
          plugin,
          store,
          missionId,
          nodeId,
          prompt: promptInput,
          team,
        })
        if (promptInput.reply && compoundReplay?.active) {
          consumeCompoundReactivation(nodeId, compoundReplay.latch)
        }
      }
    },

    async setBrief(nodeId, partial) {
      const existingBrief = new RegistryDatabase(plugin.directory, { readonly: true }).getNodeBrief(
        missionId,
        nodeId,
      )
      const merged = await mergeAndSaveBrief(plugin.directory, missionId, nodeId, partial)
      const briefChanged = JSON.stringify(existingBrief ?? null) !== JSON.stringify(merged)
      const state = readOrchestrationState(plugin.directory, missionId)
      const planStep = input.planStep?.()
      const compoundReplay = input.compoundReplay?.()

      if (compoundReplay?.active && state && briefChanged && state.nodes[nodeId]?.status === "done") {
        armCompoundReactivation(nodeId, compoundReplay.latch)
      }

      if (compoundReplay?.active && state && shouldSkipCompoundSetBriefDeliver(state, nodeId, briefChanged)) {
        gatehouseLog(
          "info",
          `[orchestration:${missionId}] skip compound replay setBrief deliver for done node ${nodeId}`,
        )
        return
      }
      if (state && !planStep && nodeAlreadyActivated(state, nodeId)) {
        gatehouseLog(
          "info",
          `[orchestration:${missionId}] skip setBrief deliver for ${nodeId} (${state.nodes[nodeId]?.status})`,
        )
        return
      }
      if (state && planStep && isPlanStepCompleted(state, planStep.id)) {
        return
      }
      await deliverNodeBriefSystemPrompt({
        plugin,
        store,
        missionId,
        nodeId,
        brief: merged,
      })
    },

    readMissionContext() {
      return readMissionContextForScript(plugin.directory, missionId)
    },

    readContract(opts) {
      return readContractForScript(plugin.directory, missionId, opts?.view)
    },

    async waitFor(nodeId, _event, opts) {
      const readState = () => readOrchestrationState(plugin.directory, missionId)
      const state = readState()
      if (state && nodeIsCompleteForWait(state, nodeId)) return
      await waitForOrchestration(missionId, nodeId, "complete", {
        readState,
        ...(opts?.timeout && { timeout: opts.timeout }),
      })
    },

    async waitForRollup(rootNodeId) {
      const descendants = collectDescendants(team, rootNodeId).filter((id) => id !== rootNodeId)
      for (const nodeId of descendants) {
        await ctx.waitFor(nodeId, "complete")
      }
    },

    async parallel(thunks) {
      return orchestrationParallel(thunks)
    },

    async pipeline(items, ...stages) {
      return orchestrationPipeline(items, ...stages)
    },

    phase(title) {
      mutateOrchestrationState(plugin.directory, missionId, (state) => {
        state.phase = title
      })
    },

    log(message) {
      gatehouseLog("info", `[orchestration:${missionId}] ${message}`)
    },

    nodeIds() {
      return Object.keys(team.nodes)
    },

    leaves() {
      return Object.keys(team.nodes).filter((nodeId) => childNodeIdsFromSpec(team, nodeId).length === 0)
    },

    children(nodeId) {
      return childNodeIdsFromSpec(team, nodeId)
    },

    template: {
      workOrder(nodeId, opts) {
        return formatWorkOrderText(plugin.directory, {
          missionId,
          nodeId,
          ...(opts?.context && { context: opts.context }),
          ...(opts?.note && { note: opts.note }),
          ...(opts?.wave !== undefined && { wave: opts.wave }),
        })
      },
      rework(nodeId, reworkInput) {
        return formatReworkText(plugin.directory, {
          missionId,
          nodeId,
          requester: reworkInput.requester,
          reason: reworkInput.reason,
          ...(reworkInput.evidence && { evidence: reworkInput.evidence }),
        })
      },
      reworkResume(nodeId, resumeInput) {
        return formatReworkResumeText(plugin.directory, {
          missionId,
          nodeId,
          blocker: resumeInput.blocker,
          ...(resumeInput.reason && { reason: resumeInput.reason }),
        })
      },
    },
  }

  return ctx
}

function collectDescendants(team: TeamSpec, rootNodeId: string) {
  const ids: string[] = []
  const walk = (nodeId: string) => {
    ids.push(nodeId)
    for (const child of childNodeIdsFromSpec(team, nodeId)) walk(child)
  }
  walk(rootNodeId)
  return ids
}
