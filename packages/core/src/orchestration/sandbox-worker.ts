import { compilePlanStepStatement } from "./plan-step-compile.ts"
import { orchestrationParallel, orchestrationPipeline } from "./primitives.ts"
import { createSandboxMissionContext } from "./sandbox-ctx.ts"
import type { SandboxInitMessage, SandboxRpcRequest, SandboxRpcResponse, SandboxWorkerOutbound } from "./sandbox-protocol.ts"
import type { MissionContext } from "./types.ts"
import type { PlanStep } from "./plan-types.ts"

declare const self: Worker

const pendingRpc = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>()

function sendRpc(request: Omit<SandboxRpcRequest, "type" | "id">) {
  const id = crypto.randomUUID()
  return new Promise<unknown>((resolve, reject) => {
    pendingRpc.set(id, { resolve, reject })
    self.postMessage({ type: "rpc", id, ...request } satisfies SandboxWorkerOutbound)
  })
}

function wrapCtxWithStep(ctx: MissionContext, stepId: string, stepIndex: number): MissionContext {
  const nest = { depth: 0 }
  const withStep = <T extends Omit<SandboxRpcRequest, "type" | "id" | "stepId" | "stepIndex" | "markPlanStepComplete">>(
    request: T,
    markPlanStepComplete: boolean,
  ) =>
    sendRpc({
      ...request,
      stepId,
      stepIndex,
      ...(markPlanStepComplete && { markPlanStepComplete: true }),
    })

  const markLinearPlanStepComplete = () => nest.depth === 0

  return {
    ...ctx,
    async prompt(nodeIds, promptInput) {
      const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds]
      await withStep({ op: "prompt", nodeIds: ids, input: promptInput }, markLinearPlanStepComplete())
    },
    async setBrief(nodeId, partial) {
      await withStep({ op: "setBrief", nodeId, partial }, markLinearPlanStepComplete())
    },
    async waitFor(nodeId, _event, opts) {
      await withStep(
        {
          op: "waitFor",
          nodeId,
          event: "complete",
          ...(opts?.timeout && { timeout: opts.timeout }),
        },
        markLinearPlanStepComplete(),
      )
    },
    async waitForRollup(rootNodeId) {
      await withStep({ op: "waitForRollup", rootNodeId }, markLinearPlanStepComplete())
    },
    async parallel(thunks) {
      nest.depth += 1
      try {
        return await orchestrationParallel(thunks)
      } finally {
        nest.depth -= 1
        if (nest.depth === 0) {
          await withStep({ op: "planStepComplete" }, true)
        }
      }
    },
    async pipeline(items, ...stages) {
      nest.depth += 1
      try {
        return await orchestrationPipeline(items, ...stages)
      } finally {
        nest.depth -= 1
        if (nest.depth === 0) {
          await withStep({ op: "planStepComplete" }, true)
        }
      }
    },
    phase(title) {
      void withStep({ op: "phase", title }, markLinearPlanStepComplete())
    },
    log(message) {
      void withStep({ op: "log", message }, markLinearPlanStepComplete())
    },
  }
}

self.onmessage = (event: MessageEvent<SandboxInitMessage | SandboxRpcResponse>) => {
  const data = event.data
  if (data.type === "rpc-response") {
    const entry = pendingRpc.get(data.id)
    if (!entry) return
    pendingRpc.delete(data.id)
    if (data.ok) entry.resolve(data.result)
    else entry.reject(new Error(data.error ?? "sandbox rpc failed"))
    return
  }

  if (data.type === "init") {
    void runOrchestrate(data)
  }
}

async function runStatement(ctx: MissionContext, statement: string) {
  const runner = compilePlanStepStatement(statement) as (ctx: MissionContext) => Promise<unknown>
  await runner(ctx)
}

async function runOrchestrate(init: SandboxInitMessage) {
  try {
    const baseCtx = createSandboxMissionContext({
      missionId: init.missionId,
      locale: init.locale,
      team: init.team,
      ...(init.objective && { objective: init.objective }),
      sendRpc,
    })

    if (init.plan?.steps.length) {
      await runPlanSteps(baseCtx, init.plan.steps, init.plan.cursor_step_index ?? 0)
      self.postMessage({ type: "done" })
      return
    }

    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
      ...args: string[]
    ) => (ctx: MissionContext) => Promise<void>

    const orchestrate = new AsyncFunction("ctx", init.orchestrateSource)
    await orchestrate(baseCtx)
    self.postMessage({ type: "done" })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    self.postMessage({ type: "error", message })
  }
}

async function runPlanSteps(ctx: MissionContext, steps: PlanStep[], startIndex: number) {
  for (let index = startIndex; index < steps.length; index += 1) {
    const step = steps[index]!
    const stepCtx = wrapCtxWithStep(ctx, step.id, index)
    await runStatement(stepCtx, step.statement)
  }
}
