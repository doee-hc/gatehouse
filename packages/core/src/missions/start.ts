import type { RegistryStore } from "../registry/store.ts"
import { mkdir } from "node:fs/promises"
import { readMissionsDocument, writeMissionsDocument } from "./store.ts"
import { assertCanStartRunning, type MissionEntry } from "./parse.ts"
import { missionEntryToRecord } from "./contract.ts"
import { writeActiveMission } from "../portal/active-mission.ts"
import { treeDir } from "../paths.ts"
import { freezeMissionContract } from "./contract-freeze.ts"

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
  const seen = new Set<string>()
  for (const item of entry.done_when) {
    const normalized = item.trim()
    if (!normalized) {
      throw new Error(`Mission ${entry.id} has an empty done_when entry in missions.yaml`)
    }
    if (seen.has(normalized)) {
      throw new Error(
        `Mission ${entry.id} has duplicate done_when entry in missions.yaml: ${JSON.stringify(normalized)}`,
      )
    }
    seen.add(normalized)
  }
}

export async function startMissionFromYaml(input: {
  projectDirectory: string
  missionId: string
  registry: RegistryStore
}) {
  const doc = await readMissionsDocument(input.projectDirectory)
  assertCanStartRunning(doc, input.registry)
  const entry = doc.missions.find((mission) => mission.id === input.missionId)
  if (!entry) throw new Error(`Mission not found in missions.yaml: ${input.missionId}`)
  validateMissionStartEntry(entry)

  const startedAt = new Date().toISOString()
  const lockedAt = startedAt
  entry.status = "running"
  entry.started_at = startedAt

  const record = missionEntryToRecord(entry, { lockedAt, isActive: true, status: "running" })
  input.registry.activateMission(record)
  await writeActiveMission(input.projectDirectory, input.missionId)
  await mkdir(treeDir(input.projectDirectory, input.missionId), { recursive: true })
  // Freeze structured done_when from raw YAML after the registry row exists,
  // but before writeMissionsDocument flattens missions.yaml.
  await freezeMissionContract(input.projectDirectory, input.missionId)
  await writeMissionsDocument(input.projectDirectory, doc)

  return { entry, record, started_at: startedAt }
}
