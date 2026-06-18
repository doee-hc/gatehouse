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
import { normalizeDependsOn, waitNodeIds } from "./depends-on.ts"
import { readLatestOrchestrationPlanRecord } from "./plan-store.ts"
import type { PlanStep } from "./plan-types.ts"
import {
  advanceReplayCursor,
  isReplayStepComplete,
} from "./replay-cursor.ts"
import {
  armCompoundReactivation,
  compoundReactivatedNodes,
  consumeCompoundReactivation,
  decideReplyPrompt,
  decideSetBriefDeliver,
  planStepKind,
  shouldArmCompoundReactivation,
} from "./replay-policy.ts"
import {
  markNodeRunning,
  mutateOrchestrationState,
  nodeAlreadyActivated,
  nodeIsCompleteForWait,
  readOrchestrationState,
} from "./state.ts"
import type { SandboxRpcRequest } from "./sandbox-protocol.ts"
import type { MissionContext, MissionScriptMeta, OrchestrationEngine, PromptInput } from "./types.ts"
import { waitForOrchestration } from "./wait.ts"
import {
  formatReworkResumeText,
  formatReworkText,
  formatWorkOrderText,
} from "./templates.ts"
import { orchestrationFork, orchestrationRun } from "./run-fork.ts"
import { RegistryDatabase } from "../registry/db.ts"

const PROMPT_TEXT_MAX = 32_768
const MAX_REPLY_PROMPTS_PER_MISSION = 500

export type MissionRuntime = {
  ctx: MissionContext
  engine: OrchestrationEngine
}

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

  const runtime = createMissionContext({
    ...input,
    planStep: () => activePlanStep,
  })

  function resolveActivePlanStepMeta(step: { id: string; index: number } | undefined) {
    if (!step) return undefined
    const plan = readLatestOrchestrationPlanRecord(input.plugin.directory, missionId)
    return plan?.steps[step.index]?.id === step.id ? plan.steps[step.index] : plan?.steps.find((s) => s.id === step.id)
  }

  function finishPlanStep() {
    if (!activePlanStep) return
    const step = activePlanStep
    const plan = readLatestOrchestrationPlanRecord(input.plugin.directory, missionId)
    mutateOrchestrationState(input.plugin.directory, missionId, (state) => {
      advanceReplayCursor(state, step.id, step.index, plan?.steps ?? [])
    })
  }

  async function handleRpc(request: SandboxRpcRequest): Promise<unknown> {
    activePlanStep =
      request.stepId && request.stepIndex !== undefined
        ? { id: request.stepId, index: request.stepIndex }
        : undefined
    activePlanStepMeta = resolveActivePlanStepMeta(activePlanStep)

    try {
      const state = readOrchestrationState(input.plugin.directory, missionId)
      if (activePlanStep && state && isReplayStepComplete(state, activePlanStep.index)) {
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
          await runtime.engine.prompt(nodeIds.length === 1 ? nodeIds[0]! : nodeIds, promptInput)
          return undefined
        }
        case "setBrief": {
          if (!request.nodeId) throw new Error("setBrief requires nodeId")
          assertNodeInTeam(input.team, request.nodeId)
          await runtime.engine.setBrief(request.nodeId, request.partial ?? {})
          return undefined
        }
        case "readMissionContext":
          return runtime.ctx.readMissionContext()
        case "readContract":
          return runtime.ctx.readContract(request.view ? { view: request.view } : undefined)
        case "waitFor": {
          if (!request.nodeId) throw new Error("waitFor requires nodeId")
          assertNodeInTeam(input.team, request.nodeId)
          await runtime.engine.waitFor(
            request.nodeId,
            "complete",
            request.timeout ? { timeout: request.timeout } : undefined,
          )
          return undefined
        }
        case "stepComplete": {
          finishPlanStep()
          return undefined
        }
        default:
          throw new Error(`unsupported sandbox rpc op: ${(request as SandboxRpcRequest).op}`)
      }
    } finally {
      activePlanStep = undefined
      activePlanStepMeta = undefined
    }
  }

  return { ctx: runtime.ctx, engine: runtime.engine, handleRpc, missionId }
}

function assertNodeInTeam(team: TeamSpec, nodeId: string) {
  if (!team.nodes[nodeId]) {
    throw new Error(`unknown node_id in orchestration script: ${nodeId}`)
  }
}

function assertPromptAllowed(team: TeamSpec, nodeIds: string[], input: PromptInput, replyCount: number) {
  if (nodeIds.length === 0) throw new Error("prompt requires at least one nodeId")
  for (const nodeId of nodeIds) assertNodeInTeam(team, nodeId)
  for (const nodeId of waitNodeIds(normalizeDependsOn(input.dependsOn))) assertNodeInTeam(team, nodeId)
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
}): MissionRuntime {
  const { plugin, store, team } = input
  const missionId = team.mission_id
  const contract = readActiveMissionContract(plugin.directory, missionId)

  function resolveStepMeta(planStep: { id: string; index: number } | undefined) {
    if (!planStep) return undefined
    const plan = readLatestOrchestrationPlanRecord(plugin.directory, missionId)
    return plan?.steps[planStep.index]?.id === planStep.id
      ? plan.steps[planStep.index]
      : plan?.steps.find((s) => s.id === planStep.id)
  }

  const engine: OrchestrationEngine = {
    async prompt(nodeIds, promptInput) {
      const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds]
      const state = readOrchestrationState(plugin.directory, missionId)
      if (!state) throw new Error(`orchestration state missing for ${missionId}`)
      const planStep = input.planStep?.()
      const stepMeta = resolveStepMeta(planStep)
      const stepKind = planStepKind(stepMeta?.op)
      const reactivated = compoundReactivatedNodes(state.compound_replay, planStep?.id)

      const toMarkRunning: string[] = []
      const toDeliver: string[] = []

      for (const nodeId of ids) {
        if (promptInput.reply) {
          if (!promptInput.text?.trim()) {
            throw new Error(`prompt(reply:true) requires text for node ${nodeId}`)
          }
          const decision = decideReplyPrompt({
            state,
            nodeId,
            hasPlanStep: Boolean(planStep),
            stepIndex: planStep?.index,
            stepKind,
            reactivated,
          })
          if (decision === "skip") {
            gatehouseLog(
              "info",
              `[orchestration:${missionId}] skip replay prompt for ${nodeId} (step=${planStep?.id ?? "none"})`,
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
            const decision = decideReplyPrompt({
              state: fresh,
              nodeId,
              hasPlanStep: Boolean(planStep),
              stepIndex: planStep?.index,
              stepKind,
              reactivated: compoundReactivatedNodes(fresh.compound_replay, planStep?.id),
            })
            if (decision === "skip") continue
            if (!planStep && nodeAlreadyActivated(fresh, nodeId)) continue
            markNodeRunning(fresh, nodeId)
          }
        })
      }

      const dependencyIds = waitNodeIds(normalizeDependsOn(promptInput.dependsOn))
      for (const depId of dependencyIds) {
        const readState = () => readOrchestrationState(plugin.directory, missionId)
        const fresh = readState()
        if (fresh && nodeIsCompleteForWait(fresh, depId)) continue
        await waitForOrchestration(missionId, depId, "complete", { readState })
      }

      for (const nodeId of toDeliver) {
        const decision = decideReplyPrompt({
          state,
          nodeId,
          hasPlanStep: Boolean(planStep),
          stepIndex: planStep?.index,
          stepKind,
          reactivated,
        })
        if (promptInput.reply && decision === "skip") continue
        await deliverOrchestrationPrompt({
          plugin,
          store,
          missionId,
          nodeId,
          prompt: promptInput,
          team,
        })
        if (promptInput.reply && stepKind === "compound" && planStep) {
          mutateOrchestrationState(plugin.directory, missionId, (fresh) => {
            consumeCompoundReactivation(fresh, planStep.id, nodeId)
          })
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
      if (!state) throw new Error(`orchestration state missing for ${missionId}`)
      const planStep = input.planStep?.()
      const stepMeta = resolveStepMeta(planStep)
      const stepKind = planStepKind(stepMeta?.op)

      if (planStep && shouldArmCompoundReactivation({ stepKind, briefChanged, state, nodeId })) {
        mutateOrchestrationState(plugin.directory, missionId, (fresh) => {
          armCompoundReactivation(fresh, planStep.id, nodeId)
        })
      }

      if (
        !decideSetBriefDeliver({
          state,
          nodeId,
          hasPlanStep: Boolean(planStep),
          stepIndex: planStep?.index,
          stepKind,
          briefChanged,
        })
      ) {
        gatehouseLog(
          "info",
          `[orchestration:${missionId}] skip replay setBrief deliver for ${nodeId}`,
        )
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

    async waitFor(nodeId, _event, opts) {
      const readState = () => readOrchestrationState(plugin.directory, missionId)
      const state = readState()
      if (state && nodeIsCompleteForWait(state, nodeId)) return
      await waitForOrchestration(missionId, nodeId, "complete", {
        readState,
        ...(opts?.timeout && { timeout: opts.timeout }),
      })
    },
  }

  const ctx: MissionContext = {
    objective: contract?.objective ?? "",

    async run(nodeId, opts) {
      await orchestrationRun(engine, nodeId, opts, {
        defaultWorkOrder: (nodeId) =>
          formatWorkOrderText(plugin.directory, {
            missionId,
            nodeId,
          }),
      })
    },

    async fork(tracks) {
      return orchestrationFork(tracks)
    },

    readMissionContext() {
      return readMissionContextForScript(plugin.directory, missionId)
    },

    readContract(opts) {
      return readContractForScript(plugin.directory, missionId, opts?.view)
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

  return { ctx, engine }
}
