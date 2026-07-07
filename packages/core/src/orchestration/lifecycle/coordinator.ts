import { existsSync } from "node:fs"
import path from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { gatehouseRoot } from "../../paths.ts"
import { RegistryDatabase } from "../../registry/db.ts"
import type { RegistryStore } from "../../registry/store.ts"
import type { MissionManifest } from "../../missions/manifest/types.ts"
import type { MissionTeamSpec } from "../../missions/manifest/types.ts"
import { saveOrchestrationPlanRecord } from "../plan/store.ts"
import type { LoadedMissionScript, MissionScriptMeta } from "../types.ts"
import {
  ensureOrchestrationNodesInitialized,
  initOrchestrationState,
  orchestrationStateNeedsNodeInit,
  readOrchestrationState,
  writeOrchestrationState,
} from "../state/store.ts"
import { notifyArchitectOrchestrationFailure } from "../engine/notify.ts"
import { startSandboxOrchestration } from "../sandbox/runtime.ts"

export function orchestrationDbExists(projectDirectory: string) {
  return existsSync(path.join(gatehouseRoot(projectDirectory), "registry.db"))
}

export function saveMissionScriptRecord(
  projectDirectory: string,
  input: {
    team: MissionTeamSpec
    meta?: MissionScriptMeta
    scriptPath?: string
    scriptHash?: string
  },
) {
  new RegistryDatabase(projectDirectory).saveMissionScript({
    missionId: input.team.mission_id,
    team: input.team,
    ...(input.meta && { meta: input.meta }),
    ...(input.scriptPath && { scriptPath: input.scriptPath }),
    ...(input.scriptHash && { scriptHash: input.scriptHash }),
  })
}

export async function prepareOrchestrationRuntime(
  projectDirectory: string,
  manifest: MissionManifest,
  script: LoadedMissionScript,
) {
  if (!script.orchestrateSource?.trim()) {
    return {
      status: "error" as const,
      code: "SCRIPT_MISSING_ORCHESTRATE",
      message: "mission.script.ts must export default async function orchestrate(ctx)",
    }
  }
  if (!script.plan) {
    return {
      status: "error" as const,
      code: "SCRIPT_PLAN_MISSING",
      message: "mission.script.ts failed plan compilation",
    }
  }

  saveMissionScriptRecord(projectDirectory, {
    team: script.team,
    ...(script.meta && { meta: script.meta }),
    scriptPath: script.scriptPath,
    scriptHash: script.scriptHash,
  })
  saveOrchestrationPlanRecord(projectDirectory, script.plan)

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
  manifest: MissionManifest,
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
