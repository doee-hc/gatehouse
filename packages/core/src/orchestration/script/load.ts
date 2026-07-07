import { missionScriptPath } from "../../paths.ts"
import { dryRunMissionScriptSource } from "./validate.ts"
import type { LoadedMissionScript } from "../types.ts"
import { MissionScriptParseError } from "./parse.ts"

export async function readMissionScriptSource(
  projectDirectory: string,
  missionId: string,
): Promise<string | undefined> {
  const scriptPath = missionScriptPath(projectDirectory, missionId)
  if (!(await Bun.file(scriptPath).exists())) return undefined
  return Bun.file(scriptPath).text()
}

export async function loadMissionScript(
  projectDirectory: string,
  missionId: string,
): Promise<LoadedMissionScript | undefined> {
  const scriptPath = missionScriptPath(projectDirectory, missionId)
  const source = await readMissionScriptSource(projectDirectory, missionId)
  if (!source) return undefined

  const dryRun = await dryRunMissionScriptSource(source, missionId)
  if (!dryRun.ok) {
    throw new MissionScriptParseError(dryRun.code, dryRun.message)
  }

  const parsed = dryRun.parsed
  return {
    team: parsed.team,
    ...(parsed.meta && { meta: parsed.meta }),
    ...(parsed.orchestrateSource && { orchestrateSource: parsed.orchestrateSource }),
    scriptSource: parsed.scriptSource,
    scriptHash: parsed.scriptHash,
    scriptPath,
    plan: dryRun.plan,
  }
}
