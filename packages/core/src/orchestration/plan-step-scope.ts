import type { TeamSpec } from "../tree/types.ts"
import { compilePlanStepStatement } from "./plan-step-compile.ts"
import type { PlanStep } from "./plan-types.ts"
import { orchestrationFork, orchestrationJoin, orchestrationRun } from "./run-join-fork.ts"
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
  team: TeamSpec
  step: PlanStep
  index: number
  sendRpc: RpcSender
}): PlanStepScope {
  const { baseCtx, team, step, index, sendRpc } = input

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
    async run(target, opts) {
      await orchestrationRun(engine, target, opts, {
        defaultWorkOrder: (nodeId) => baseCtx.template.workOrder(nodeId),
      })
    },
    async join(target, opts) {
      await orchestrationJoin(engine, target, opts, team)
    },
    async fork(tracks) {
      return orchestrationFork(tracks)
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
