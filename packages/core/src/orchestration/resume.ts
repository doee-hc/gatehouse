import type { PluginInput } from "@opencode-ai/plugin"
import type { RegistryStore } from "../registry/store.ts"
import { readManifest } from "../tree/store.ts"
import type { TreeManifest } from "../tree/types.ts"
import { loadMissionScript } from "./script-load.ts"
import { notifyArchitectOrchestrationFailure } from "./notify.ts"
import {
  assertOrchestrationPlanVersion,
  assertOrchestrationScriptHash,
  orchestrationNeedsResume,
  readOrchestrationState,
} from "./state.ts"
import { isSandboxRunning, startSandboxOrchestration } from "./sandbox-runtime.ts"

export { orchestrationNeedsResume } from "./state.ts"

export async function resumeOrchestrationRuntime(
  input: PluginInput,
  store: RegistryStore,
  manifest: TreeManifest,
  missionId: string,
) {
  const state = readOrchestrationState(input.directory, missionId)
  if (!orchestrationNeedsResume(state, isSandboxRunning(missionId))) {
    return { status: "not_resumable" as const }
  }

  const script = await loadMissionScript(input.directory, missionId)
  if (!script) {
    return { status: "error" as const, message: "mission.script.ts not found" }
  }

  const hashCheck = assertOrchestrationScriptHash(state, script.scriptHash)
  if (!hashCheck.ok) {
    return { status: "error" as const, message: hashCheck.message }
  }
  if (script.plan) {
    const planCheck = assertOrchestrationPlanVersion(state, script.plan.plan_version)
    if (!planCheck.ok) {
      return { status: "error" as const, message: planCheck.message }
    }
  }

  const started = await startSandboxOrchestration({
    plugin: input,
    store,
    script,
    resume: true,
  })
  if (started.status === "error") {
    await notifyArchitectOrchestrationFailure(store, input.directory, {
      missionId,
      error: started.message,
      scriptHash: script.scriptHash,
    })
    return { status: "error" as const, message: started.message }
  }

  return {
    status: "resumed" as const,
    mission_id: missionId,
    orchestration_runtime: started,
    phase: state?.phase,
    resumed: true as const,
  }
}

export async function resumeOrchestrationForActiveMission(
  input: PluginInput,
  store: RegistryStore,
  missionId: string,
) {
  const manifest = await readManifest(input.directory, missionId)
  if (!manifest) return { status: "not_resumable" as const }
  return resumeOrchestrationRuntime(input, store, manifest, missionId)
}
