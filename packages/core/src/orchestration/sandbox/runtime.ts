import type { PluginInput } from "@opencode-ai/plugin"
import { readLocaleSync } from "../../locale.ts"
import { gatehouseLog } from "../../log.ts"
import { readActiveMissionContract } from "../../missions/contract.ts"
import type { RegistryStore } from "../../registry/store.ts"
import { createMissionHostHandlers } from "./host.ts"
import {
  markSandboxRunning,
  markSandboxStopped,
  orchestrationAllDone,
  readOrchestrationState,
  writeOrchestrationState,
} from "../state/store.ts"
import { saveOrchestrationPlanRecord } from "../plan/store.ts"
import { replayNextStepIndex } from "../plan/replay.ts"
import { clearMissionWaits } from "../engine/wait.ts"
import type {
  SandboxHostInbound,
  SandboxHostOutbound,
  SandboxInitMessage,
  SandboxRpcResponse,
} from "./protocol.ts"
import type { LoadedMissionScript } from "../types.ts"

const runningSandboxes = new Set<string>()
const workersByMission = new Map<string, Worker>()

export function isSandboxRunning(missionId: string) {
  return runningSandboxes.has(missionId)
}

export async function startSandboxOrchestration(input: {
  plugin: PluginInput
  store: RegistryStore
  script: LoadedMissionScript
  resume?: boolean
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

  const state = readOrchestrationState(input.plugin.directory, missionId)
  if (state) {
    markSandboxRunning(state, input.script.scriptHash, input.script.plan.plan_version)
    writeOrchestrationState(input.plugin.directory, state)
  }
  saveOrchestrationPlanRecord(input.plugin.directory, input.script.plan)

  runningSandboxes.add(missionId)
  const host = createMissionHostHandlers({
    plugin: input.plugin,
    store: input.store,
    team: input.script.team,
    ...(input.script.meta && { meta: input.script.meta }),
  })

  const worker = new Worker(new URL("./worker.ts", import.meta.url).href, { type: "module" })
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
    plan: {
      plan_version: input.script.plan.plan_version,
      steps: input.script.plan.steps,
      cursor_step_index: replayNextStepIndex(state),
    },
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
        persistSandboxOutcome(input.plugin.directory, missionId, "completed")
        cleanupSandboxWorker(missionId)
        resolve({ status: "done" })
        return
      }
      if (data.type === "error") {
        gatehouseLog("error", `orchestration sandbox failed for ${missionId}: ${data.message}`)
        persistSandboxOutcome(input.plugin.directory, missionId, "failed", data.message)
        cleanupSandboxWorker(missionId)
        resolve({ status: "error", message: data.message })
      }
    }

    worker.onerror = (event) => {
      const message = event.message || "sandbox worker error"
      gatehouseLog("error", `orchestration sandbox worker error for ${missionId}: ${message}`)
      persistSandboxOutcome(input.plugin.directory, missionId, "failed", message)
      cleanupSandboxWorker(missionId)
      resolve({ status: "error", message })
    }
  })

  worker.postMessage(initMessage)
  if (input.resume) {
    gatehouseLog("info", `[orchestration:${missionId}] replaying orchestrate() (resume)`)
  }

  const startupResult = await Promise.race([
    firstPromptPromise.then(() => ({ status: "first_prompt" as const })),
    workerDone,
    new Promise<{ status: "timeout" }>((resolve) => setTimeout(() => resolve({ status: "timeout" }), 2000)),
  ])
  await input.store.flushPendingDeliveries()

  if (startupResult.status === "error") {
    return {
      status: "error" as const,
      mission_id: missionId,
      message: startupResult.message,
    }
  }

  void workerDone.then((result) => {
    if (result.status === "error") {
      gatehouseLog("error", `orchestration sandbox exited for ${missionId}: ${result.message}`)
      return
    }
    const latest = readOrchestrationState(input.plugin.directory, missionId)
    if (latest && orchestrationAllDone(latest)) {
      gatehouseLog("info", `[orchestration:${missionId}] orchestrate() finished; all nodes done`)
    }
  })

  return {
    status: "started" as const,
    mission_id: missionId,
    sandbox: true as const,
    ...(input.resume && { resumed: true as const }),
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

function persistSandboxOutcome(
  projectDirectory: string,
  missionId: string,
  outcome: "stopped" | "completed" | "failed",
  error?: string,
) {
  const state = readOrchestrationState(projectDirectory, missionId)
  if (!state) return
  markSandboxStopped(state, outcome, error)
  writeOrchestrationState(projectDirectory, state)
}

function cleanupSandboxWorker(missionId: string) {
  runningSandboxes.delete(missionId)
  clearMissionWaits(missionId)
  const worker = workersByMission.get(missionId)
  if (worker) {
    worker.terminate()
    workersByMission.delete(missionId)
  }
}

export function stopSandboxOrchestration(missionId: string) {
  cleanupSandboxWorker(missionId)
}
