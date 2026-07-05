import type { MissionTeamSpec } from "../missions/manifest/types.ts"
import { compilePlanStepStatement } from "./plan-step-compile.ts"
import type { PlanStep } from "./plan-types.ts"
import { orchestrationRun } from "./run.ts"
import { orchestrationParallel } from "./primitives.ts"
import type { SandboxRpcRequest } from "./sandbox-protocol.ts"
import type { MissionContext, OrchestrationEngine } from "./types.ts"

type RpcSender = (request: Omit<SandboxRpcRequest, "type" | "id">) => Promise<unknown>

export type PlanStepScope = {
  step: PlanStep
  index: number
  run: () => Promise<void>
  complete: () => Promise<void>
}

export function createPlanStepScope(input: {
  baseCtx: MissionContext
  team: MissionTeamSpec
  step: PlanStep
  index: number
  sendRpc: RpcSender
  workOrderText: (nodeId: string, supplementary?: string) => string
}): PlanStepScope {
  const { baseCtx, step, index, sendRpc } = input

  const withStep = (request: Omit<SandboxRpcRequest, "type" | "id" | "stepId" | "stepIndex">) =>
    sendRpc({ ...request, stepId: step.id, stepIndex: index }) as Promise<void>

  const engine = {
    setBrief: (nodeId: string, partial: Parameters<OrchestrationEngine["setBrief"]>[1]) =>
      withStep({ op: "setBrief", nodeId, partial }),
    prompt: (nodeIds: string | string[], promptInput: Parameters<OrchestrationEngine["prompt"]>[1]) => {
      const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds]
      return withStep({ op: "prompt", nodeIds: ids, input: promptInput })
    },
    waitFor: (nodeId: string, _event: "complete", opts?: { timeout?: string }) =>
      withStep({
        op: "waitFor",
        nodeId,
        event: "complete",
        ...(opts?.timeout && { timeout: opts.timeout }),
      }),
  } satisfies OrchestrationEngine

  const stepCtx: MissionContext = {
    ...baseCtx,
    async run(nodeId, opts) {
      await orchestrationRun(engine, nodeId, opts, { workOrderText: input.workOrderText })
    },
    async parallel(tracks) {
      return orchestrationParallel(tracks)
    },
  }

  return {
    step,
    index,
    async run() {
      const runner = compilePlanStepStatement(step.statement) as (ctx: MissionContext) => Promise<unknown>
      await runner(stepCtx)
    },
    async complete() {
      await withStep({ op: "stepComplete" })
    },
  }
}
