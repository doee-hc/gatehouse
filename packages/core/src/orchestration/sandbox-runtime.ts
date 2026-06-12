import type { PluginInput } from "@opencode-ai/plugin"
import { readLocaleSync } from "../locale.ts"
import { gatehouseLog } from "../log.ts"
import { readActiveMissionContract } from "../missions/contract.ts"
import type { RegistryStore } from "../registry/store.ts"
import { createMissionHostHandlers } from "./ctx-host.ts"
import type {
  SandboxHostInbound,
  SandboxHostOutbound,
  SandboxInitMessage,
  SandboxRpcResponse,
} from "./sandbox-protocol.ts"
import type { LoadedMissionScript } from "./types.ts"

const runningSandboxes = new Set<string>()
const workersByMission = new Map<string, Worker>()

export function isSandboxRunning(missionId: string) {
  return runningSandboxes.has(missionId)
}

export async function startSandboxOrchestration(input: {
  plugin: PluginInput
  store: RegistryStore
  script: LoadedMissionScript
}) {
  const missionId = input.script.team.mission_id
  if (!input.script.orchestrateSource) {
    return {
      status: "no_orchestrate" as const,
      mission_id: missionId,
      note: "mission.script.ts has team but no default orchestrate() export",
    }
  }
  if (runningSandboxes.has(missionId)) {
    return { status: "already_running" as const, mission_id: missionId }
  }

  runningSandboxes.add(missionId)
  const host = createMissionHostHandlers({
    plugin: input.plugin,
    store: input.store,
    team: input.script.team,
    ...(input.script.meta && { meta: input.script.meta }),
  })

  const worker = new Worker(new URL("./sandbox-worker.ts", import.meta.url).href, { type: "module" })
  workersByMission.set(missionId, worker)

  let resolveFirstPrompt: (() => void) | undefined
  const firstPromptPromise = new Promise<void>((resolve) => {
    resolveFirstPrompt = resolve
  })
  let sawFirstPrompt = false

  const contract = readActiveMissionContract(input.plugin.directory, missionId)
  const initMessage: SandboxInitMessage = {
    type: "init",
    orchestrateSource: input.script.orchestrateSource,
    missionId,
    locale: readLocaleSync(input.plugin.directory),
    team: input.script.team,
    ...(contract?.objective && { objective: contract.objective }),
    ...(input.script.meta && { meta: input.script.meta }),
  }

  const workerDone = new Promise<{ status: "done" } | { status: "error"; message: string }>((resolve) => {
    worker.onmessage = (event: MessageEvent<SandboxHostInbound>) => {
      const data = event.data
      if (data.type === "rpc") {
        void handleWorkerRpc(worker, host, input.store, data, {
          onPrompt: () => {
            if (sawFirstPrompt) return
            sawFirstPrompt = true
            resolveFirstPrompt?.()
          },
        })
        return
      }
      if (data.type === "done") {
        cleanupSandboxWorker(missionId)
        resolve({ status: "done" })
        return
      }
      if (data.type === "error") {
        gatehouseLog("error", `orchestration sandbox failed for ${missionId}: ${data.message}`)
        cleanupSandboxWorker(missionId)
        resolve({ status: "error", message: data.message })
      }
    }

    worker.onerror = (event) => {
      const message = event.message || "sandbox worker error"
      gatehouseLog("error", `orchestration sandbox worker error for ${missionId}: ${message}`)
      cleanupSandboxWorker(missionId)
      resolve({ status: "error", message })
    }
  })

  worker.postMessage(initMessage)
  await Promise.race([
    firstPromptPromise,
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ])
  await input.store.flushPendingDeliveries()

  void workerDone.then((result) => {
    if (result.status === "error") {
      gatehouseLog("error", `orchestration sandbox exited for ${missionId}: ${result.message}`)
    }
  })

  return {
    status: "started" as const,
    mission_id: missionId,
    sandbox: true as const,
  }
}

async function handleWorkerRpc(
  worker: Worker,
  host: ReturnType<typeof createMissionHostHandlers>,
  store: RegistryStore,
  request: Extract<SandboxHostInbound, { type: "rpc" }>,
  hooks?: { onPrompt?: () => void },
) {
  const response: SandboxRpcResponse = { type: "rpc-response", id: request.id, ok: true }
  try {
    response.result = await host.handleRpc(request)
    response.ok = true
    if (request.op === "prompt") {
      await store.flushPendingDeliveries()
      hooks?.onPrompt?.()
    }
  } catch (error) {
    response.ok = false
    response.error = error instanceof Error ? error.message : String(error)
  }
  worker.postMessage(response satisfies SandboxHostOutbound)
}

function cleanupSandboxWorker(missionId: string) {
  runningSandboxes.delete(missionId)
  const worker = workersByMission.get(missionId)
  if (worker) {
    worker.terminate()
    workersByMission.delete(missionId)
  }
}

export function stopSandboxOrchestration(missionId: string) {
  cleanupSandboxWorker(missionId)
}
