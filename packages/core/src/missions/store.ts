import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { leadDir } from "../paths.ts"
import { deactivateInnerAgentsForMissions, reconcileInactiveMissionInnerAgents } from "../registry/mission-agents.ts"
import { parseMissionsFile, type MissionsDocument } from "./parse.ts"
import { stringifyYaml } from "../yaml.ts"

export function readMissionsDocumentSync(projectDirectory: string) {
  const file = path.join(leadDir(projectDirectory), "missions.yaml")
  if (!existsSync(file)) return parseMissionsFile("schema_version: 1\nmissions: []\n")
  return parseMissionsFile(readFileSync(file, "utf8"))
}

export async function readMissionsDocument(projectDirectory: string) {
  const file = Bun.file(path.join(leadDir(projectDirectory), "missions.yaml"))
  if (!(await file.exists())) {
    return parseMissionsFile("schema_version: 1\nmissions: []\n")
  }
  return parseMissionsFile(await file.text())
}

export async function writeMissionsDocument(projectDirectory: string, doc: MissionsDocument) {
  const target = path.join(leadDir(projectDirectory), "missions.yaml")
  await Bun.write(target, stringifyYaml(doc))
  reconcileInactiveMissionInnerAgents(projectDirectory, doc)
}

export async function setMissionStatus(projectDirectory: string, missionId: string, status: string) {
  const doc = await readMissionsDocument(projectDirectory)
  const mission = doc.missions.find((entry) => entry.id === missionId)
  if (!mission) throw new Error(`Mission not found in missions.yaml: ${missionId}`)
  if (mission.status === status) return doc
  mission.status = status
  if (status === "done" && !mission.completed_at) mission.completed_at = new Date().toISOString()
  await writeMissionsDocument(projectDirectory, doc)
  if (status === "done" || status === "cancelled") {
    deactivateInnerAgentsForMissions(projectDirectory, [missionId])
  }
  return doc
}
