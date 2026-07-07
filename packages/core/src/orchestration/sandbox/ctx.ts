import type { GatehouseLocale } from "../../locale.ts"
import type { OrchestrationPlan } from "../plan/types.ts"
import type { MissionTeamSpec } from "../../missions/manifest/types.ts"
import type { MissionContext, OrchestrationEngine, PromptInput } from "../types.ts"
import type { NodeBriefPartial } from "../types.ts"
import type { SandboxRpcRequest } from "./protocol.ts"
import { createWorkOrderTextFactory } from "../engine/templates.ts"
import { buildMissionContext } from "./mission-ctx-shell.ts"

type RpcSender = (request: Omit<SandboxRpcRequest, "type" | "id">) => Promise<unknown>

export function createSandboxMissionContext(input: {
  missionId: string
  locale: GatehouseLocale
  team: MissionTeamSpec
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
      const result = await sendRpc({
        op: "waitFor",
        nodeId,
        event: "complete",
        ...(opts?.timeout && { timeout: opts.timeout }),
      })
      if (result && typeof result === "object" && "completion" in (result as Record<string, unknown>)) {
        return { completion: (result as { completion?: import("../types.ts").NodeCompletion }).completion }
      }
      return undefined
    },
  }

  const workOrderText = createWorkOrderTextFactory({ missionId, locale })
  const ctx = buildMissionContext({
    objective: input.objective ?? "",
    team,
    engine,
    runConfig: { workOrderText },
    resolvePlan: () => plan,
    readMissionContext() {
      throw new Error("readMissionContext() is not available synchronously in sandbox; inline static context in run brief or text")
    },
    readContract() {
      throw new Error("readContract() is not available synchronously in sandbox")
    },
  })

  return { ctx, engine, workOrderText }
}
