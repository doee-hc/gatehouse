import { leadDir } from "../paths.ts"
import { freezeMissionContractToRegistry, readMissionContractRawRegistry } from "../execution/artifacts.ts"
import { isRecord, parseYaml, readString } from "../yaml.ts"

/** Freeze mission contract into registry.db (structured done_when preserved). */
export async function freezeMissionContract(projectDirectory: string, missionId: string) {
  return freezeMissionContractToRegistry(projectDirectory, missionId)
}

export async function readFrozenMissionEntry(projectDirectory: string, missionId: string) {
  const raw = await readMissionContractRawRegistry(projectDirectory, missionId)
  if (isRecord(raw)) return raw

  const missionsFile = Bun.file(`${leadDir(projectDirectory)}/missions.yaml`)
  if (!(await missionsFile.exists())) return undefined
  const doc = parseYaml(await missionsFile.text())
  if (!isRecord(doc) || !Array.isArray(doc.missions)) return undefined
  for (const item of doc.missions) {
    if (isRecord(item) && readString(item.id) === missionId) return item
  }
  return undefined
}
