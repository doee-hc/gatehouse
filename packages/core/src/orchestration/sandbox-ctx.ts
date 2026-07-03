import { planChildNodeIds, planLeafNodeIds } from "./plan-graph.ts"
import type { GatehouseLocale } from "../locale.ts"
import type { OrchestrationPlan } from "./plan-types.ts"
import type { TeamSpec } from "../tree/types.ts"
import { orchestrationFork, orchestrationRun } from "./run-fork.ts"
import type { MissionContext, OrchestrationEngine, PromptInput } from "./types.ts"
import type { SandboxRpcRequest } from "./sandbox-protocol.ts"
import {
  formatReworkResumeTextWithLocale,
  formatReworkTextWithLocale,
  formatWorkOrderTextWithLocale,
} from "./templates.ts"
import type { NodeBriefPartial } from "./types.ts"

type RpcSender = (request: Omit<SandboxRpcRequest, "type" | "id">) => Promise<unknown>

export function createSandboxMissionContext(input: {
  missionId: string
  locale: GatehouseLocale
  team: TeamSpec
  plan: Pick<OrchestrationPlan, "steps">
  objective?: string
  sendRpc: RpcSender
}) {
  const { missionId, locale, team, plan, sendRpc } = input

  const engine: OrchestrationEngine = {
    async setBrief(nodeId, partial: NodeBriefPartial) {
      await sendRpc({ op: "setBrief", nodeId, partial })
    },
    async prompt(nodeIds, promptInput: PromptInput) {
      const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds]
      await sendRpc({ op: "prompt", nodeIds: ids, input: promptInput })
    },
    async waitFor(nodeId, _event, opts) {
      await sendRpc({
        op: "waitFor",
        nodeId,
        event: "complete",
        ...(opts?.timeout && { timeout: opts.timeout }),
      })
    },
  }

  const defaultWorkOrder = (nodeId: string) =>
    formatWorkOrderTextWithLocale(locale, {
      missionId,
      nodeId,
    })

  const ctx: MissionContext = {
    objective: input.objective ?? "",

    async run(nodeId, opts) {
      await orchestrationRun(engine, nodeId, opts, { defaultWorkOrder })
    },

    async fork(tracks) {
      return orchestrationFork(tracks)
    },

    readMissionContext() {
      throw new Error("readMissionContext() is not available synchronously in sandbox; inline static context in prompt text")
    },

    readContract() {
      throw new Error("readContract() is not available synchronously in sandbox")
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

  return { ctx, engine }
}
