import type { PluginInput } from "@opencode-ai/plugin"
import type { RegistryStore } from "../registry/store.ts"
import { readManifest } from "../tree/store.ts"
import type { TreeManifest } from "../tree/types.ts"
import { loadMissionScript } from "./script-load.ts"
import { notifyArchitectOrchestrationFailure } from "./notify.ts"
import { readOrchestrationState } from "./state.ts"
import type { OrchestrationState } from "./types.ts"
import { isSandboxRunning, startSandboxOrchestration } from "./sandbox-runtime.ts"

export function orchestrationCanRetry(state: OrchestrationState | undefined, sandboxRunning: boolean) {
  if (sandboxRunning) return false
  if (!state) return false
  const nodes = Object.values(state.nodes)
  if (nodes.length === 0) return false
  return nodes.every((node) => node.status === "pending" && !node.activated_at)
}

export async function retryOrchestrationRuntime(
  input: PluginInput,
  store: RegistryStore,
  manifest: TreeManifest,
  missionId: string,
) {
  const state = readOrchestrationState(input.directory, missionId)
  if (!orchestrationCanRetry(state, isSandboxRunning(missionId))) {
    return { status: "not_retryable" as const }
  }

  const script = await loadMissionScript(input.directory, missionId)
  if (!script) {
    return { status: "error" as const, message: "mission.script.ts not found" }
  }

  const started = await startSandboxOrchestration({ plugin: input, store, script })
  if (started.status === "error") {
    await notifyArchitectOrchestrationFailure(store, input.directory, {
      missionId,
      error: started.message,
    })
    return { status: "error" as const, message: started.message }
  }

  return {
    status: "retried" as const,
    mission_id: missionId,
    orchestration_runtime: started,
    phase: state?.phase,
  }
}

export async function retryOrchestrationForActiveMission(input: PluginInput, store: RegistryStore, missionId: string) {
  const manifest = await readManifest(input.directory, missionId)
  if (!manifest) return { status: "not_retryable" as const }
  return retryOrchestrationRuntime(input, store, manifest, missionId)
}
