import { mkdir } from "node:fs/promises"
import path from "node:path"
import { RegistryDatabase } from "../registry/db.ts"
import {
  parseContractRawFromYamlExport,
  parseMissionRawDoneWhenFromContractRaw,
} from "../registry/mission-artifacts-db.ts"
import { gatehouseRoot, internalExportsDir, missionContractPath } from "../paths.ts"
import { isRecord, parseYaml, readString, stringifyYaml } from "../yaml.ts"
import type { NodeBrief } from "./types.ts"

function db(projectDirectory: string, readonly = false) {
  return new RegistryDatabase(projectDirectory, readonly ? { readonly: true } : undefined)
}

async function readonlyDb(projectDirectory: string) {
  const dbPath = path.join(gatehouseRoot(projectDirectory), "registry.db")
  if (!(await Bun.file(dbPath).exists())) return undefined
  return db(projectDirectory, true)
}

export async function readRawMissionEntryFromYaml(projectDirectory: string, missionId: string) {
  const missionsFile = Bun.file(path.join(projectDirectory, ".gatehouse/lead/missions.yaml"))
  if (!(await missionsFile.exists())) return undefined
  const raw = parseYaml(await missionsFile.text())
  if (!isRecord(raw) || !Array.isArray(raw.missions)) return undefined
  for (const item of raw.missions) {
    if (!isRecord(item) || readString(item.id) !== missionId) continue
    return item
  }
  return undefined
}

export async function freezeMissionContractToRegistry(projectDirectory: string, missionId: string) {
  const rawEntry = await readRawMissionEntryFromYaml(projectDirectory, missionId)
  if (!isRecord(rawEntry)) {
    throw new Error(`Mission not found in missions.yaml: ${missionId}`)
  }
  const registry = db(projectDirectory)
  registry.saveMissionContractRaw(missionId, rawEntry)
  await exportMissionContractYaml(projectDirectory, missionId, rawEntry)
  return rawEntry
}

async function exportMissionContractYaml(projectDirectory: string, missionId: string, rawEntry: unknown) {
  const exportDir = path.join(internalExportsDir(projectDirectory), "trees", missionId)
  await mkdir(exportDir, { recursive: true })
  await Bun.write(
    path.join(exportDir, "mission-contract.yaml"),
    stringifyYaml({
      schema_version: 3,
      frozen_at: new Date().toISOString(),
      mission: rawEntry,
      note: "Human/debug export only — agents must use gatehouse_mission_info",
    }),
  )
}

export async function readMissionRawDoneWhen(projectDirectory: string, missionId: string) {
  const registry = await readonlyDb(projectDirectory)
  if (registry) {
    const fromDb = registry.getMissionContractRaw(missionId)
    if (fromDb) {
      const raw = parseMissionRawDoneWhenFromContractRaw(fromDb)
      if (raw) return raw
    }
  }
  const legacyFile = Bun.file(missionContractPath(projectDirectory, missionId))
  if (await legacyFile.exists()) {
    const parsed = parseContractRawFromYamlExport(await legacyFile.text())
    if (parsed) return parseMissionRawDoneWhenFromContractRaw(parsed)
  }
  return readRawMissionEntryFromYaml(projectDirectory, missionId).then((entry) =>
    entry && isRecord(entry) && Array.isArray(entry.done_when) ? entry.done_when : undefined,
  )
}

export async function readNodeBriefRegistry(
  projectDirectory: string,
  missionId: string,
  nodeId: string,
) {
  const registry = await readonlyDb(projectDirectory)
  return registry?.getNodeBrief(missionId, nodeId)
}

export async function readMissionContractRawRegistry(projectDirectory: string, missionId: string) {
  const registry = await readonlyDb(projectDirectory)
  const fromDb = registry?.getMissionContractRaw(missionId)
  if (fromDb) return fromDb
  const legacyFile = Bun.file(missionContractPath(projectDirectory, missionId))
  if (await legacyFile.exists()) {
    const parsed = parseContractRawFromYamlExport(await legacyFile.text())
    if (parsed) {
      db(projectDirectory).saveMissionContractRaw(missionId, parsed)
      return parsed
    }
  }
  return undefined
}

export type { NodeBrief }
