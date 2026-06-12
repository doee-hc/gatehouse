import { missionScriptPath } from "../paths.ts"
import type { TeamSpec } from "../tree/types.ts"
import { loadMissionScript } from "./script-load.ts"
import type { LoadedMissionScript, MissionScriptMeta } from "./types.ts"

export type ResolvedTeamSource = {
  spec: TeamSpec
  script: LoadedMissionScript
}

export async function resolveTeamSource(
  projectDirectory: string,
  missionId: string,
): Promise<ResolvedTeamSource | undefined> {
  const script = await loadMissionScript(projectDirectory, missionId)
  if (!script) return undefined
  return { spec: script.team, script }
}

export function missionScriptPathForMission(projectDirectory: string, missionId: string) {
  return missionScriptPath(projectDirectory, missionId)
}

export type { MissionScriptMeta }
