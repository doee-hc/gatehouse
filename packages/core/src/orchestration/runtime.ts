import type { PluginInput } from "@opencode-ai/plugin"
import type { RegistryStore } from "../registry/store.ts"
import type { TreeManifest } from "../tree/types.ts"
import { saveMissionScriptRecord } from "./context.ts"
import type { LoadedMissionScript } from "./types.ts"
import {
  initOrchestrationState,
  readOrchestrationState,
  writeOrchestrationState,
} from "./state.ts"
import { startSandboxOrchestration } from "./sandbox-runtime.ts"

export async function prepareOrchestrationRuntime(
  projectDirectory: string,
  manifest: TreeManifest,
  script: LoadedMissionScript,
) {
  saveMissionScriptRecord(projectDirectory, {
    team: script.team,
    ...(script.meta && { meta: script.meta }),
    scriptPath: script.scriptPath,
    scriptHash: script.scriptHash,
  })

  const existing = readOrchestrationState(projectDirectory, manifest.mission_id)
  if (existing) {
    return { status: "prepared" as const, state: existing, script }
  }

  const nodeIds = Object.keys(manifest.nodes)
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
  const started = await startSandboxOrchestration({ plugin: input, store, script })
  return {
    ...started,
    phase: prepared.state.phase,
  }
}
