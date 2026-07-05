import type { MissionTeamSpec } from "../missions/manifest/types.ts"
import { createPlanStepScope } from "./plan-step-scope.ts"
import type { PlanStep } from "./plan-types.ts"
import type { SandboxRpcRequest } from "./sandbox-protocol.ts"
import type { MissionContext } from "./types.ts"

type RpcSender = (request: Omit<SandboxRpcRequest, "type" | "id">) => Promise<unknown>

/** Replay compiled plan steps from cursor; each step runs then explicitly completes. */
export async function replayPlanSteps(input: {
  baseCtx: MissionContext
  team: MissionTeamSpec
  steps: readonly PlanStep[]
  startIndex: number
  sendRpc: RpcSender
  workOrderText: (nodeId: string, supplementary?: string) => string
}) {
  for (let index = input.startIndex; index < input.steps.length; index += 1) {
    const step = input.steps[index]!
    const scope = createPlanStepScope({
      baseCtx: input.baseCtx,
      team: input.team,
      step,
      index,
      sendRpc: input.sendRpc,
      workOrderText: input.workOrderText,
    })
    await scope.run()
    await scope.complete()
  }
}
