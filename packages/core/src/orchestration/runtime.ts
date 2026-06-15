import type { PluginInput } from "@opencode-ai/plugin"
import type { RegistryStore } from "../registry/store.ts"
import type { TreeManifest } from "../tree/types.ts"
import { saveMissionScriptRecord } from "./context.ts"
import { saveOrchestrationPlanRecord } from "./plan-store.ts"
import type { LoadedMissionScript } from "./types.ts"
import {
  ensureOrchestrationNodesInitialized,
  initOrchestrationState,
  orchestrationStateNeedsNodeInit,
  readOrchestrationState,
  writeOrchestrationState,
} from "./state.ts"
import { notifyArchitectOrchestrationFailure } from "./notify.ts"
import { startSandboxOrchestration } from "./sandbox-runtime.ts"

export async function prepareOrchestrationRuntime(
  projectDirectory: string,
  manifest: TreeManifest,
  script: LoadedMissionScript,
) {
  if (!script.orchestrateSource?.trim()) {
    return {
      status: "error" as const,
      code: "SCRIPT_MISSING_ORCHESTRATE",
      message: "mission.script.ts must export default async function orchestrate(ctx)",
    }
  }

  saveMissionScriptRecord(projectDirectory, {
    team: script.team,
    ...(script.meta && { meta: script.meta }),
    scriptPath: script.scriptPath,
    scriptHash: script.scriptHash,
  })
  if (script.plan) {
    saveOrchestrationPlanRecord(projectDirectory, script.plan)
  }

  const nodeIds = Object.keys(manifest.nodes)
  const existing = readOrchestrationState(projectDirectory, manifest.mission_id)
  if (existing) {
    if (orchestrationStateNeedsNodeInit(existing, nodeIds)) {
      const state = ensureOrchestrationNodesInitialized(existing, nodeIds)
      writeOrchestrationState(projectDirectory, state)
      return { status: "prepared" as const, state, script }
    }
    return { status: "prepared" as const, state: existing, script }
  }

  const state = initOrchestrationState(manifest.mission_id, nodeIds)
  writeOrchestrationState(projectDirectory, state)
  return { status: "prepared" as const, state, script }
}

export async function startOrchestrationRuntime(
  input: PluginInput,
  store: RegistryStore,
  manifest: TreeManifest,
  script: LoadedMissionScript,
) {
  const prepared = await prepareOrchestrationRuntime(input.directory, manifest, script)
  if (prepared.status === "error") {
    await notifyArchitectOrchestrationFailure(store, input.directory, {
      missionId: manifest.mission_id,
      error: prepared.message,
      scriptHash: script.scriptHash,
    })
    return { status: "error" as const, mission_id: manifest.mission_id, message: prepared.message }
  }
  const started = await startSandboxOrchestration({ plugin: input, store, script })
  if (started.status === "error") {
    await notifyArchitectOrchestrationFailure(store, input.directory, {
      missionId: manifest.mission_id,
      error: started.message,
      scriptHash: script.scriptHash,
    })
  }
  return {
    ...started,
    phase: prepared.state.phase,
  }
}
