import type { PluginInput } from "@opencode-ai/plugin"
import { gatehouseLog } from "../log.ts"
import { readMissionsDocument } from "../missions/store.ts"
import { runningMissionIds } from "../missions/parse.ts"
import type { RegistryStore } from "../registry/store.ts"
import { readManifest } from "../tree/store.ts"
import { hasOrchestrationRuntime } from "./state.ts"
import { resumeOrchestrationRuntime } from "./resume.ts"
export async function resumeOrchestrationForRunningMissions(input: PluginInput, store: RegistryStore) {
  const doc = await readMissionsDocument(input.directory)
  const missionIds = runningMissionIds(doc)
  const results: Array<{ mission_id: string; status: string }> = []

  for (const missionId of missionIds) {
    if (!hasOrchestrationRuntime(input.directory, missionId)) continue
    const manifest = await readManifest(input.directory, missionId)
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
