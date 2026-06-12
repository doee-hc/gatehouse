import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { RegistryDatabase } from "../registry/db.ts"
import {
  gatehouseRoot,
  legacyManifestPath,
  legacyRetroManifestPath,
  manifestExportPath,
  retroManifestExportPath,
  treeDir,
  treesIndexPath,
} from "../paths.ts"
import type { RetroManifest, TeamSpec, TreeManifest, TreesIndex, TreesIndexEntry } from "./types.ts"
import { parseTreeManifest } from "./parse.ts"
import { isRecord, parseYaml, readString, stringifyYaml } from "../yaml.ts"

async function readText(filePath: string) {
  const file = Bun.file(filePath)
  if (!(await file.exists())) return undefined
  return file.text()
}

async function writeText(filePath: string, text: string) {
  await Bun.write(filePath, text)
}

function treeRegistry(projectDirectory: string, readonly?: boolean) {
  const dbPath = path.join(gatehouseRoot(projectDirectory), "registry.db")
  const useReadonly = readonly && existsSync(dbPath)
  return new RegistryDatabase(projectDirectory, useReadonly ? { readonly: true } : undefined)
}

async function readManifestYamlExport(projectDirectory: string, missionId: string) {
  for (const filePath of [
    manifestExportPath(projectDirectory, missionId),
    legacyManifestPath(projectDirectory, missionId),
  ]) {
    const text = await readText(filePath)
    if (text) return parseTreeManifest(text)
  }
  return undefined
}

function readManifestYamlExportSync(projectDirectory: string, missionId: string) {
  for (const filePath of [
    manifestExportPath(projectDirectory, missionId),
    legacyManifestPath(projectDirectory, missionId),
  ]) {
    if (!existsSync(filePath)) continue
    return parseTreeManifest(readFileSync(filePath, "utf8"))
  }
  return undefined
}

async function importManifestFromYamlExport(projectDirectory: string, missionId: string) {
  const manifest = await readManifestYamlExport(projectDirectory, missionId)
  if (!manifest) return undefined
  treeRegistry(projectDirectory).saveTreeManifest(manifest)
  return manifest
}

function importManifestFromYamlExportSync(projectDirectory: string, missionId: string) {
  const manifest = readManifestYamlExportSync(projectDirectory, missionId)
  if (!manifest) return undefined
  treeRegistry(projectDirectory).saveTreeManifest(manifest)
  return manifest
}

/** Write manifest YAML under internal/exports for human inspection; runtime reads registry.db only. */
export async function exportTreeManifestYaml(projectDirectory: string, manifest: TreeManifest) {
  const filePath = manifestExportPath(projectDirectory, manifest.mission_id)
  await Bun.$`mkdir -p ${path.dirname(filePath)}`.quiet()
  await writeText(filePath, stringifyYaml(manifest))
}

export async function exportRetroManifestYaml(projectDirectory: string, retro: RetroManifest) {
  const filePath = retroManifestExportPath(projectDirectory, retro.mission_id)
  await Bun.$`mkdir -p ${path.dirname(filePath)}`.quiet()
  await writeText(filePath, stringifyYaml(retro))
}


export function readManifestSync(projectDirectory: string, missionId: string) {
  const manifest = treeRegistry(projectDirectory, true).getTreeManifest(missionId)
  if (manifest) return manifest
  return importManifestFromYamlExportSync(projectDirectory, missionId)
}

export async function readManifest(projectDirectory: string, missionId: string) {
  const manifest = treeRegistry(projectDirectory, true).getTreeManifest(missionId)
  if (manifest) return manifest
  return importManifestFromYamlExport(projectDirectory, missionId)
}

export async function writeManifest(projectDirectory: string, manifest: TreeManifest) {
  treeRegistry(projectDirectory).saveTreeManifest(manifest)
  await exportTreeManifestYaml(projectDirectory, manifest)
}

async function readRetroManifestYamlExport(projectDirectory: string, missionId: string) {
  let text: string | undefined
  for (const filePath of [
    retroManifestExportPath(projectDirectory, missionId),
    legacyRetroManifestPath(projectDirectory, missionId),
  ]) {
    text = await readText(filePath)
    if (text) break
  }
  if (!text) return undefined
  const raw = parseYaml(text)
  if (!isRecord(raw)) throw new Error("retro-manifest must be a mapping")
  const mission_id = readString(raw.mission_id)
  const created_at = readString(raw.created_at)
  if (!mission_id || !created_at) throw new Error("retro-manifest missing mission_id or created_at")
  const retro_order = Array.isArray(raw.retro_order)
    ? raw.retro_order.filter((item): item is string => typeof item === "string")
    : []
  const nodes: RetroManifest["nodes"] = {}
  if (isRecord(raw.nodes)) {
    for (const [nodeId, value] of Object.entries(raw.nodes)) {
      if (!isRecord(value)) continue
      const exec_session_id = readString(value.exec_session_id)
      const retro_session_id = readString(value.retro_session_id)
      if (!exec_session_id || !retro_session_id) continue
      const child_nodes = Array.isArray(value.child_nodes)
        ? value.child_nodes.filter((item): item is string => typeof item === "string")
        : []
      nodes[nodeId] = { exec_session_id, retro_session_id, child_nodes }
    }
  }
  return { mission_id, created_at, nodes, retro_order } satisfies RetroManifest
}

async function importRetroManifestFromYamlExport(projectDirectory: string, missionId: string) {
  const retro = await readRetroManifestYamlExport(projectDirectory, missionId)
  if (!retro) return undefined
  treeRegistry(projectDirectory).saveRetroManifest(retro)
  return retro
}

export async function readRetroManifest(projectDirectory: string, missionId: string) {
  const retro = treeRegistry(projectDirectory, true).getRetroManifest(missionId)
  if (retro) return retro
  return importRetroManifestFromYamlExport(projectDirectory, missionId)
}

export async function writeRetroManifest(projectDirectory: string, retro: RetroManifest) {
  treeRegistry(projectDirectory).saveRetroManifest(retro)
  await exportRetroManifestYaml(projectDirectory, retro)
}

function parseTreesIndex(text: string): TreesIndex {
  const raw = parseYaml(text)
  if (!isRecord(raw) || !Array.isArray(raw.trees)) return { trees: [] }
  const trees = raw.trees
    .map((entry): TreesIndexEntry | undefined => {
      if (!isRecord(entry)) return
      const mission_id = readString(entry.mission_id)
      const root_session_id = readString(entry.root_session_id)
      const root_node = readString(entry.root_node)
      const status = readString(entry.status)
      const created_at = readString(entry.created_at)
      if (!mission_id || !root_session_id || !root_node || !status || !created_at) return
      const objective = readString(entry.objective)
      return {
        mission_id,
        root_session_id,
        root_node,
        status,
        created_at,
        ...(objective && { objective }),
      }
    })
    .filter((entry): entry is TreesIndexEntry => entry !== undefined)
  return { trees }
}

function readTreesIndexFromDb(projectDirectory: string): TreesIndex {
  const dbPath = path.join(gatehouseRoot(projectDirectory), "registry.db")
  if (!existsSync(dbPath)) return { trees: [] }
  return treeRegistry(projectDirectory, true).listTreesIndex()
}

export function readTreesIndexSync(projectDirectory: string): TreesIndex {
  const fromDb = readTreesIndexFromDb(projectDirectory)
  if (fromDb.trees.length > 0) return fromDb
  const file = treesIndexPath(projectDirectory)
  if (!existsSync(file)) return { trees: [] }
  return parseTreesIndex(readFileSync(file, "utf8"))
}

export async function readTreesIndex(projectDirectory: string): Promise<TreesIndex> {
  const fromDb = readTreesIndexFromDb(projectDirectory)
  if (fromDb.trees.length > 0) return fromDb
  const text = await readText(treesIndexPath(projectDirectory))
  if (!text) return { trees: [] }
  return parseTreesIndex(text)
}

/** @deprecated Trees index is derived from registry.db; kept as a no-op for callers. */
export async function upsertTreesIndex(_projectDirectory: string, _entry: TreesIndexEntry) {}

export async function findMissionBySession(projectDirectory: string, sessionId: string) {
  const byExec = treeRegistry(projectDirectory, true).findTreeManifestByExecSession(sessionId)
  if (byExec) return byExec
  const byRetro = treeRegistry(projectDirectory, true).findTreeManifestByRetroSession(sessionId)
  if (byRetro) return byRetro
  return undefined
}

export async function resolveRecipientSession(
  projectDirectory: string,
  missionId: string,
  input: { session_id?: string; node_id?: string },
) {
  const manifest = await readManifest(projectDirectory, missionId)
  if (!manifest) throw new Error(`tree manifest not found in registry for mission ${missionId}`)
  if (input.node_id) {
    const node = manifest.nodes[input.node_id]
    if (!node) throw new Error(`unknown node_id: ${input.node_id}`)
    return { manifest, node_id: input.node_id, session_id: node.session_id }
  }
  if (input.session_id) {
    const match = Object.entries(manifest.nodes).find(([, node]) => node.session_id === input.session_id)
    if (!match) throw new Error(`session_id not in mission manifest: ${input.session_id}`)
    return { manifest, node_id: match[0], session_id: input.session_id }
  }
  throw new Error("recipient requires session_id or node_id")
}

export type { TeamSpec, TreeManifest, RetroManifest }
