import type { TeamSpec } from "../tree/types.ts"
import { createSandboxMissionContext } from "./sandbox-ctx.ts"
import { replayPlanSteps } from "./plan-replay-runner.ts"
import type { SandboxInitMessage, SandboxRpcRequest, SandboxRpcResponse, SandboxWorkerOutbound } from "./sandbox-protocol.ts"
import type { MissionContext } from "./types.ts"

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

async function runOrchestrate(init: SandboxInitMessage) {
  try {
    const runtime = createSandboxMissionContext({
      missionId: init.missionId,
      locale: init.locale,
      team: init.team,
      plan: init.plan ?? { steps: [] },
      ...(init.objective && { objective: init.objective }),
      sendRpc,
    })

    if (init.plan?.steps.length) {
      await replayPlanSteps({
        baseCtx: runtime.ctx,
        team: init.team,
        steps: init.plan.steps,
        startIndex: init.plan.cursor_step_index ?? 0,
        sendRpc,
        workOrderText: runtime.workOrderText,
      })
      self.postMessage({ type: "done" })
      return
    }

    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
      ...args: string[]
    ) => (ctx: MissionContext) => Promise<void>

    const orchestrate = new AsyncFunction("ctx", init.orchestrateSource)
    await orchestrate(runtime.ctx)
    self.postMessage({ type: "done" })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    self.postMessage({ type: "error", message })
  }
}
