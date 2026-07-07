import type { MissionTeamSpec } from "../../missions/manifest/types.ts"
import { createSandboxMissionContext } from "./ctx.ts"
import { replayPlanSteps } from "../plan/replay.ts"
import { runOrchestrateSource } from "./mission-ctx-shell.ts"
import type { SandboxInitMessage, SandboxRpcRequest, SandboxRpcResponse, SandboxWorkerOutbound } from "./protocol.ts"

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

    await runOrchestrateSource(init.orchestrateSource, runtime.ctx)
    self.postMessage({ type: "done" })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    self.postMessage({ type: "error", message })
  }
}
