import type { PluginInput } from "@opencode-ai/plugin"
import { gatehouseLog } from "../../log.ts"
import { readMissionsDocument } from "../../missions/store.ts"
import { runningMissionIds } from "../../missions/parse.ts"
import type { RegistryStore } from "../../registry/store.ts"
import { readMissionManifest } from "../../missions/manifest/store.ts"
import type { MissionManifest } from "../../missions/manifest/types.ts"
import { loadMissionScript } from "../script/load.ts"
import { notifyArchitectOrchestrationFailure } from "../engine/notify.ts"
import {
  assertOrchestrationPlanVersion,
  assertOrchestrationScriptHash,
  hasOrchestrationRuntime,
  orchestrationNeedsResume,
  readOrchestrationState,
} from "../state/store.ts"
import { isSandboxRunning, startSandboxOrchestration } from "../sandbox/runtime.ts"

export { orchestrationNeedsResume } from "../state/store.ts"

export async function resumeOrchestrationRuntime(
  input: PluginInput,
  store: RegistryStore,
  manifest: MissionManifest,
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
  if (!script.plan) {
    return { status: "error" as const, message: "mission.script.ts failed plan compilation" }
  }

  const hashCheck = assertOrchestrationScriptHash(state, script.scriptHash)
  if (!hashCheck.ok) {
    return { status: "error" as const, message: hashCheck.message }
  }
  const planCheck = assertOrchestrationPlanVersion(state, script.plan.plan_version)
  if (!planCheck.ok) {
    return { status: "error" as const, message: planCheck.message }
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
  const manifest = await readMissionManifest(input.directory, missionId)
  if (!manifest) return { status: "not_resumable" as const }
  return resumeOrchestrationRuntime(input, store, manifest, missionId)
}

export async function resumeOrchestrationForRunningMissions(input: PluginInput, store: RegistryStore) {
  const doc = await readMissionsDocument(input.directory)
  const missionIds = runningMissionIds(doc)
  const results: Array<{ mission_id: string; status: string }> = []

  for (const missionId of missionIds) {
    if (!hasOrchestrationRuntime(input.directory, missionId)) continue
    const manifest = await readMissionManifest(input.directory, missionId)
    if (!manifest) continue

    const result = await resumeOrchestrationRuntime(input, store, manifest, missionId)
    if (result.status === "resumed") {
      gatehouseLog("info", `[orchestration:${missionId}] resumed sandbox after plugin startup`)
      results.push({ mission_id: missionId, status: "resumed" })
      continue
    }
    if (result.status === "error") {
      gatehouseLog("error", `[orchestration:${missionId}] resume failed: ${result.message}`)
      results.push({ mission_id: missionId, status: "error" })
    }
  }

  return results
}
