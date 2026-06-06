import path from "node:path"
import { gatehouseRoot } from "../paths.ts"
import { isRecord, parseYaml, readString, stringifyYaml } from "../yaml.ts"

const REL = path.join("portal", "active-mission.yaml")

export async function readActiveMission(projectDirectory: string) {
  const file = Bun.file(path.join(gatehouseRoot(projectDirectory), REL))
  if (!(await file.exists())) return undefined
  const raw = parseYaml(await file.text())
  if (!isRecord(raw)) return undefined
  return readString(raw.mission_id)
}

export async function writeActiveMission(projectDirectory: string, missionId: string) {
  const target = path.join(gatehouseRoot(projectDirectory), REL)
  await Bun.$`mkdir -p ${path.dirname(target)}`.quiet()
  await Bun.write(target, stringifyYaml({ mission_id: missionId }))
}
