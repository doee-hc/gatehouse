import type { RegistryStore } from "../registry/store.ts"
import { readMissionsDocument, writeMissionsDocument } from "./store.ts"
import { assertCanStartRunning, type MissionEntry } from "./parse.ts"
import { missionEntryToRecord } from "./contract.ts"
import { writeActiveMission } from "../portal/active-mission.ts"
import { mkdir } from "node:fs/promises"
import { treeDir } from "../paths.ts"

export function validateMissionStartEntry(entry: MissionEntry) {
  if (entry.status !== "queued") {
    throw new Error(`Mission ${entry.id} must be queued before start (current: ${entry.status})`)
  }
  if (!entry.objective?.trim()) {
    throw new Error(`Mission ${entry.id} requires objective in missions.yaml`)
  }
  if (entry.done_when.length === 0) {
    throw new Error(`Mission ${entry.id} requires at least one done_when entry in missions.yaml`)
  }
}

export async function startMissionFromYaml(input: {
  projectDirectory: string
  missionId: string
  registry: RegistryStore
}) {
  const doc = await readMissionsDocument(input.projectDirectory)
  assertCanStartRunning(doc)
  const entry = doc.missions.find((mission) => mission.id === input.missionId)
  if (!entry) throw new Error(`Mission not found in missions.yaml: ${input.missionId}`)
  validateMissionStartEntry(entry)

  const startedAt = new Date().toISOString()
  const lockedAt = startedAt
  entry.status = "running"
  entry.started_at = startedAt
  await writeMissionsDocument(input.projectDirectory, doc)

  const record = missionEntryToRecord(entry, { lockedAt, isActive: true, status: "running" })
  input.registry.activateMission(record)
  await writeActiveMission(input.projectDirectory, input.missionId)
  await mkdir(treeDir(input.projectDirectory, input.missionId), { recursive: true })

  return { entry, record, started_at: startedAt }
}
