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
  allNodesCompleteForWait,
  markNodeRunning,
  nodeIsCompleteForWait,
  readOrchestrationState,
  writeOrchestrationState,
} from "./state.ts"
import type { SandboxRpcRequest } from "./sandbox-protocol.ts"
import type { MissionContext, MissionScriptMeta, PromptInput } from "./types.ts"
import { waitForOrchestration } from "./wait.ts"
import {
  formatReworkResumeText,
  formatReworkText,
  formatWorkOrderText,
} from "./templates.ts"

const PROMPT_TEXT_MAX = 32_768
const MAX_REPLY_PROMPTS_PER_MISSION = 500

export function createMissionHostHandlers(input: {
  plugin: PluginInput
  store: RegistryStore
  team: TeamSpec
  meta?: MissionScriptMeta
}) {
  const ctx = createMissionContext(input)
  const missionId = input.team.mission_id
  let replyPromptCount = 0

  async function handleRpc(request: SandboxRpcRequest): Promise<unknown> {
    switch (request.op) {
      case "prompt": {
        const nodeIds = request.nodeIds ?? []
        const promptInput = request.input ?? {}
        assertPromptAllowed(input.team, nodeIds, promptInput, replyPromptCount)
        if (promptInput.reply) replyPromptCount += 1
        await ctx.prompt(nodeIds.length === 1 ? nodeIds[0]! : nodeIds, promptInput)
        return undefined
      }
      case "setBrief":
        if (!request.nodeId) throw new Error("setBrief requires nodeId")
        assertNodeInTeam(input.team, request.nodeId)
        await ctx.setBrief(request.nodeId, request.partial ?? {})
        return undefined
      case "readMissionContext":
        return ctx.readMissionContext()
      case "readContract":
        return ctx.readContract(request.view ? { view: request.view } : undefined)
      case "waitFor": {
        if (!request.nodeId) throw new Error("waitFor requires nodeId")
        assertNodeInTeam(input.team, request.nodeId)
        await ctx.waitFor(request.nodeId, "complete", request.timeout ? { timeout: request.timeout } : undefined)
        return undefined
      }
      case "waitForAll": {
        const nodeIds = request.nodeIds ?? []
        for (const nodeId of nodeIds) assertNodeInTeam(input.team, nodeId)
        await ctx.waitForAll(nodeIds, "complete", request.timeout ? { timeout: request.timeout } : undefined)
        return undefined
      }
      case "waitForRollup": {
        if (!request.rootNodeId) throw new Error("waitForRollup requires rootNodeId")
        assertNodeInTeam(input.team, request.rootNodeId)
        await ctx.waitForRollup(request.rootNodeId)
        return undefined
      }
      case "phase":
        if (!request.title?.trim()) throw new Error("phase requires title")
        ctx.phase(request.title.slice(0, 128))
        return undefined
      case "log":
        ctx.log(request.message ?? "")
        return undefined
      default:
        throw new Error(`unsupported sandbox rpc op: ${(request as SandboxRpcRequest).op}`)
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

      for (const nodeId of ids) {
        if (promptInput.reply) {
          if (!promptInput.text?.trim()) {
            throw new Error(`prompt(reply:true) requires text for node ${nodeId}`)
          }
          markNodeRunning(state, nodeId)
        }
        await deliverOrchestrationPrompt({
          plugin,
          store,
          missionId,
          nodeId,
          prompt: promptInput,
          team,
        })
      }
      writeOrchestrationState(plugin.directory, state)
    },

    async setBrief(nodeId, partial) {
      const merged = await mergeAndSaveBrief(plugin.directory, missionId, nodeId, partial)
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
      const state = readOrchestrationState(plugin.directory, missionId)
      if (state && nodeIsCompleteForWait(state, nodeId)) return
      await waitForOrchestration(missionId, [nodeId], "complete", opts)
    },

    async waitForAll(nodeIds, _event, opts) {
      const state = readOrchestrationState(plugin.directory, missionId)
      if (state && allNodesCompleteForWait(state, nodeIds)) return
      await waitForOrchestration(missionId, nodeIds, "complete", opts)
    },

    async waitForRollup(rootNodeId) {
      const descendants = collectDescendants(team, rootNodeId).filter((id) => id !== rootNodeId)
      if (descendants.length === 0) return
      await ctx.waitForAll(descendants, "complete")
    },

    phase(title) {
      const state = readOrchestrationState(plugin.directory, missionId)
      if (!state) return
      state.phase = title
      writeOrchestrationState(plugin.directory, state)
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
