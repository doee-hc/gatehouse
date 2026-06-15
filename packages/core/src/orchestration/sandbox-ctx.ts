import { childNodeIdsFromSpec } from "../tree/parse.ts"
import type { GatehouseLocale } from "../locale.ts"
import type { TeamSpec } from "../tree/types.ts"
import { orchestrationParallel, orchestrationPipeline } from "./primitives.ts"
import type { MissionContext } from "./types.ts"
import type { SandboxRpcRequest } from "./sandbox-protocol.ts"
import {
  formatReworkResumeTextWithLocale,
  formatReworkTextWithLocale,
  formatWorkOrderTextWithLocale,
} from "./templates.ts"

type RpcSender = (request: Omit<SandboxRpcRequest, "type" | "id">) => Promise<unknown>

export function createSandboxMissionContext(input: {
  missionId: string
  locale: GatehouseLocale
  team: TeamSpec
  objective?: string
  sendRpc: RpcSender
}): MissionContext {
  const { missionId, locale, team, sendRpc } = input

  return {
    objective: input.objective ?? "",

    async prompt(nodeIds, promptInput) {
      const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds]
      await sendRpc({ op: "prompt", nodeIds: ids, input: promptInput })
    },

    async setBrief(nodeId, partial) {
      await sendRpc({ op: "setBrief", nodeId, partial })
    },

    readMissionContext() {
      throw new Error("readMissionContext() is not available synchronously in sandbox; inline static context in prompt text")
    },

    readContract() {
      throw new Error("readContract() is not available synchronously in sandbox")
    },

    async waitFor(nodeId, _event, opts) {
      await sendRpc({
        op: "waitFor",
        nodeId,
        event: "complete",
        ...(opts?.timeout && { timeout: opts.timeout }),
      })
    },

    async waitForRollup(rootNodeId) {
      await sendRpc({ op: "waitForRollup", rootNodeId })
    },

    async parallel(thunks) {
      return orchestrationParallel(thunks)
    },

    async pipeline(items, ...stages) {
      return orchestrationPipeline(items, ...stages)
    },

    phase(title) {
      void sendRpc({ op: "phase", title })
    },

    log(message) {
      void sendRpc({ op: "log", message })
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
