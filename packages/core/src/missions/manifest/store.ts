import { existsSync } from "node:fs"
import path from "node:path"
import { RegistryDatabase } from "../../registry/db.ts"
import {
  gatehouseRoot,
  manifestExportPath,
  retroManifestExportPath,
  extractManifestExportPath,
  verifyManifestExportPath,
} from "../../paths.ts"
import type {
  MissionExtractManifest,
  MissionManifest,
  MissionManifestIndex,
  MissionRetroManifest,
  MissionTeamSpec,
  MissionVerifyManifest,
} from "./types.ts"
import { stringifyYaml } from "../../yaml.ts"

async function writeText(filePath: string, text: string) {
  await Bun.write(filePath, text)
}

function missionRegistry(projectDirectory: string, readonly?: boolean) {
  const dbPath = path.join(gatehouseRoot(projectDirectory), "registry.db")
  const useReadonly = readonly && existsSync(dbPath)
  return new RegistryDatabase(projectDirectory, useReadonly ? { readonly: true } : undefined)
}

/** Write manifest YAML under internal/exports for human inspection; runtime reads registry.db only. */
export async function exportMissionManifestYaml(projectDirectory: string, manifest: MissionManifest) {
  const filePath = manifestExportPath(projectDirectory, manifest.mission_id)
  await Bun.$`mkdir -p ${path.dirname(filePath)}`.quiet()
  await writeText(filePath, stringifyYaml(manifest))
}

export async function exportMissionRetroManifestYaml(projectDirectory: string, retro: MissionRetroManifest) {
  const filePath = retroManifestExportPath(projectDirectory, retro.mission_id)
  await Bun.$`mkdir -p ${path.dirname(filePath)}`.quiet()
  await writeText(filePath, stringifyYaml(retro))
}

export async function exportMissionExtractManifestYaml(projectDirectory: string, extract: MissionExtractManifest) {
  const filePath = extractManifestExportPath(projectDirectory, extract.mission_id)
  await Bun.$`mkdir -p ${path.dirname(filePath)}`.quiet()
  await writeText(filePath, stringifyYaml(extract))
}

export async function exportMissionVerifyManifestYaml(projectDirectory: string, verify: MissionVerifyManifest) {
  const filePath = verifyManifestExportPath(projectDirectory, verify.mission_id)
  await Bun.$`mkdir -p ${path.dirname(filePath)}`.quiet()
  await writeText(filePath, stringifyYaml(verify))
}

export function readMissionManifestSync(projectDirectory: string, missionId: string) {
  return missionRegistry(projectDirectory, true).getMissionManifest(missionId)
}

export async function readMissionManifest(projectDirectory: string, missionId: string) {
  return missionRegistry(projectDirectory, true).getMissionManifest(missionId)
}

export async function writeMissionManifest(projectDirectory: string, manifest: MissionManifest) {
  missionRegistry(projectDirectory).saveMissionManifest(manifest)
  await exportMissionManifestYaml(projectDirectory, manifest)
}

export async function readRetroManifest(projectDirectory: string, missionId: string) {
  return missionRegistry(projectDirectory, true).getRetroManifest(missionId)
}

export async function writeRetroManifest(projectDirectory: string, retro: MissionRetroManifest) {
  missionRegistry(projectDirectory).saveRetroManifest(retro)
  await exportMissionRetroManifestYaml(projectDirectory, retro)
}

export async function readExtractManifest(projectDirectory: string, missionId: string) {
  return missionRegistry(projectDirectory, true).getExtractManifest(missionId)
}

export async function writeExtractManifest(projectDirectory: string, extract: MissionExtractManifest) {
  missionRegistry(projectDirectory).saveExtractManifest(extract)
  await exportMissionExtractManifestYaml(projectDirectory, extract)
}

export async function readVerifyManifest(projectDirectory: string, missionId: string) {
  return missionRegistry(projectDirectory, true).getVerifyManifest(missionId)
}

export async function writeVerifyManifest(projectDirectory: string, verify: MissionVerifyManifest) {
  missionRegistry(projectDirectory).saveVerifyManifest(verify)
  await exportMissionVerifyManifestYaml(projectDirectory, verify)
}

function readMissionManifestIndexFromDb(projectDirectory: string): MissionManifestIndex {
  const dbPath = path.join(gatehouseRoot(projectDirectory), "registry.db")
  if (!existsSync(dbPath)) return { missions: [] }
  return missionRegistry(projectDirectory, true).listMissionManifestIndex()
}

export function readMissionManifestIndexSync(projectDirectory: string): MissionManifestIndex {
  return readMissionManifestIndexFromDb(projectDirectory)
}

export async function readMissionManifestIndex(projectDirectory: string): Promise<MissionManifestIndex> {
  return readMissionManifestIndexFromDb(projectDirectory)
}

export async function findMissionBySession(projectDirectory: string, sessionId: string) {
  const registry = missionRegistry(projectDirectory, true)
  const byExec = registry.findMissionManifestByExecSession(sessionId)
  if (byExec) return byExec
  const byRetro = registry.findMissionManifestByRetroSession(sessionId)
  if (byRetro) return byRetro
  const byExtract = registry.findMissionManifestByExtractSession(sessionId)
  if (byExtract) return byExtract
  const byVerify = registry.findMissionManifestByVerifySession(sessionId)
  if (byVerify) return byVerify
  return undefined
}

export type {
  MissionTeamSpec,
  MissionManifest,
  MissionRetroManifest,
  MissionExtractManifest,
  MissionVerifyManifest,
}
