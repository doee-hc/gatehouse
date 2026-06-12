import { existsSync } from "node:fs"
import path from "node:path"
import { gatehouseRoot } from "../paths.ts"
import { RegistryDatabase } from "../registry/db.ts"
import type { TeamSpec } from "../tree/types.ts"
import type { MissionScriptMeta } from "./types.ts"

export { createMissionContext, createMissionHostHandlers } from "./ctx-host.ts"

export function orchestrationDbExists(projectDirectory: string) {
  return existsSync(path.join(gatehouseRoot(projectDirectory), "registry.db"))
}

export function saveMissionScriptRecord(
  projectDirectory: string,
  input: {
    team: TeamSpec
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
