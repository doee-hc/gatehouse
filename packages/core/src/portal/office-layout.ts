import path from "node:path"
import { leadDir, officeLayoutSpecPath, portalOfficeDir } from "../paths.ts"
import { parseMissionsFile, activePortalMissionIds, lingeringPortalMissionId } from "../missions/parse.ts"
import { readManifest } from "../tree/store.ts"
import { innerAgentId } from "../registry/types.ts"
import { OUTER_PROFILES } from "../names.ts"
import { spawnIdForAgent } from "./spawn-id.ts"
import { isRecord, parseYaml, readString, stringifyYaml } from "../yaml.ts"

export type OfficeLayoutNode = {
  mission_id: string
  node_id: string
  spawn_id: string
}

export type WorkstationBinding = {
  spawn_id: string
  slot: number
}

export const WORKSTATION_SEATS = 2

/** Max inner cubicle workstations on the portal map; extra agents wander without a desk slot. */
export const MAX_OFFICE_WORKSTATION_COUNT = 16

export function capOfficeWorkstationCount(workstationCount: number) {
  if (workstationCount <= 0) return 0
  return Math.min(workstationCount, MAX_OFFICE_WORKSTATION_COUNT)
}

export function workstationCountForAgents(agentCount: number) {
  if (agentCount <= 0) return 0
  return capOfficeWorkstationCount(Math.ceil(agentCount / WORKSTATION_SEATS))
}

export type OfficeLayoutSpec = {
  schema_version: 1
  revision: string
  seed: string
  workstation_count: number
  inner_nodes: OfficeLayoutNode[]
  bindings: WorkstationBinding[]
  updated_at: string
}

export type OfficeLayoutManifest = {
  version: 1
  revision: string
  mapKey: string
  mode: "scene-bg"
  sceneBgKey: string
  tileSize: number
  sceneBackgroundColor: string
  workstation_count: number
  bossLayered?: boolean
  bossLayerVersion?: number
  decorObjects?: { texture: string; file: string }[]
  warnings?: string[]
}

const OUTER_BOSS_AGENT_IDS = OUTER_PROFILES

export const BOSS_OFFICE_ANCHOR_TILE = { x: 24, y: 0 }

export const BOSS_PROP_SIZE: Record<string, { w: number; h: number }> = {
  "boss_desk_tl.png": { w: 160, h: 64 },
  "boss_desk_tr.png": { w: 96, h: 64 },
  "boss_desk_dl.png": { w: 160, h: 64 },
  "boss_desk_dr.png": { w: 128, h: 64 },
  "boss_front_wall.png": { w: 384, h: 64 },
  "chair_back.png": { w: 32, h: 64 },
  "chair_front.png": { w: 32, h: 64 },
}

export const BOSS_SIT_TILE_NUDGE_Y = -0.25

/** Pixel lift applied to inner cubicle sit anchors (matches boss outer sit visual). */
export const INNER_SIT_PIXEL_LIFT = Math.abs(BOSS_SIT_TILE_NUDGE_Y) * 32

/** Nudge inner sit/path anchors down so they land on walkable floor tiles, not desk collision. */
export const INNER_SIT_ANCHOR_DOWN_NUDGE = 4

export const OUTER_BOSS_SEATS = [
  {
    agentId: "lead",
    chairTile: { x: 3, y: 1 },
    deskTile: { x: 1, y: 2 },
    propId: "chair_back",
    deskTexture: "boss_desk_tl.png",
    sitDirection: "down" as const,
    sitTileOffsetY: 0.5,
  },
  {
    agentId: "architect",
    chairTile: { x: 9, y: 1 },
    deskTile: { x: 8, y: 2 },
    propId: "chair_back",
    deskTexture: "boss_desk_tr.png",
    sitDirection: "down" as const,
    sitTileOffsetY: 0.5,
  },
  {
    agentId: "curator",
    chairTile: { x: 3, y: 6 },
    deskTile: { x: 1, y: 5 },
    propId: "chair_front",
    deskTexture: "boss_desk_dl.png",
    sitDirection: "up" as const,
    sitTileOffsetY: 1,
  },
  {
    agentId: "arbiter",
    chairTile: { x: 8, y: 6 },
    deskTile: { x: 7, y: 5 },
    propId: "chair_front",
    deskTexture: "boss_desk_dr.png",
    sitDirection: "up" as const,
    sitTileOffsetY: 1,
  },
] as const

export function bossSeatWorld(tile: { x: number; y: number }, tileSize = 32) {
  return {
    x: (BOSS_OFFICE_ANCHOR_TILE.x + tile.x) * tileSize,
    y: (BOSS_OFFICE_ANCHOR_TILE.y + tile.y) * tileSize,
  }
}

export function chairSitOffsetForDirection(sitDirection: "up" | "down") {
  if (sitDirection === "down") return { sitX: 16, sitY: 48, sitDirection: "down" as const }
  return { sitX: 16, sitY: 12, sitDirection: "up" as const }
}

export function chairSitTileOffsetY(sitDirection: "up" | "down") {
  const base = sitDirection === "down" ? 0.5 : 1
  return base + BOSS_SIT_TILE_NUDGE_Y
}

export function chairAgentSitWorld(
  chairNodeX: number,
  chairNodeY: number,
  sitDirection: "up" | "down",
  tileSize = 32,
) {
  const sit = chairSitOffsetForDirection(sitDirection)
  return {
    x: chairNodeX + sit.sitX,
    y: chairNodeY + sit.sitY + chairSitTileOffsetY(sitDirection) * tileSize,
  }
}

export function innerAgentSitWorld(
  chairNodeX: number,
  chairNodeY: number,
  sitDirection: "up" | "down",
  tileSize = 32,
) {
  const sit = chairAgentSitWorld(chairNodeX, chairNodeY, sitDirection, tileSize)
  return {
    x: sit.x,
    y: sit.y - INNER_SIT_PIXEL_LIFT + INNER_SIT_ANCHOR_DOWN_NUDGE,
  }
}

export function bossSitTileOffsetY(seat: (typeof OUTER_BOSS_SEATS)[number]) {
  return chairSitTileOffsetY(seat.sitDirection)
}

export function bossAgentSitWorld(seat: (typeof OUTER_BOSS_SEATS)[number], tileSize = 32) {
  const chair = bossSeatWorld(seat.chairTile, tileSize)
  return chairAgentSitWorld(chair.x, chair.y, seat.sitDirection, tileSize)
}

export function bossDeskSortDepth(seat: (typeof OUTER_BOSS_SEATS)[number], tileSize = 32) {
  const desk = bossSeatWorld(seat.deskTile, tileSize)
  const size = BOSS_PROP_SIZE[seat.deskTexture]
  return desk.y + (size?.h ?? tileSize * 2)
}

export function bossChairSortDepth(seat: (typeof OUTER_BOSS_SEATS)[number], tileSize = 32) {
  const chair = bossSeatWorld(seat.chairTile, tileSize)
  const size = BOSS_PROP_SIZE[seat.propId === "chair_back" ? "chair_back.png" : "chair_front.png"]
  return chair.y + (size?.h ?? 64)
}

export function chairSitOffset(propId: string, sitDirection?: "up" | "down") {
  if (sitDirection) return chairSitOffsetForDirection(sitDirection)
  if (propId === "chair_front") return chairSitOffsetForDirection("down")
  return chairSitOffsetForDirection("up")
}

export function layoutRevisionFromWorkstationCount(workstationCount: number) {
  return `ws:${workstationCount}`
}

export function syncWorkstationBindings(
  runningNodes: OfficeLayoutNode[],
  existing: WorkstationBinding[] | undefined,
  workstationCount: number,
) {
  const activeSpawns = new Set(runningNodes.map((node) => node.spawn_id))
  const bindings = (existing ?? []).filter((entry) => activeSpawns.has(entry.spawn_id))
  const usedSlots = new Set(bindings.map((entry) => entry.slot))
  const boundSpawns = new Set(bindings.map((entry) => entry.spawn_id))
  const maxSlot = Math.max(0, workstationCount * WORKSTATION_SEATS - 1)

  for (const node of runningNodes) {
    if (boundSpawns.has(node.spawn_id)) continue
    let slot = 0
    while (slot <= maxSlot && usedSlots.has(slot)) slot++
    if (slot > maxSlot) continue
    bindings.push({ spawn_id: node.spawn_id, slot })
    usedSlots.add(slot)
    boundSpawns.add(node.spawn_id)
  }

  return bindings.sort((a, b) => a.slot - b.slot || a.spawn_id.localeCompare(b.spawn_id))
}

export function layoutSeed(revision: string) {
  let hash = 0
  for (let i = 0; i < revision.length; i++) hash = (hash * 31 + revision.charCodeAt(i)) >>> 0
  return String(hash)
}

export function layoutSeedInt(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return hash % 2_000_000_000
}

export async function readOfficeLayoutSpec(projectDirectory: string) {
  const file = Bun.file(officeLayoutSpecPath(projectDirectory))
  if (!(await file.exists())) return undefined
  const raw = parseYaml(await file.text())
  if (!isRecord(raw)) return undefined
  if (raw.schema_version !== 1) return undefined
  const revision = readString(raw.revision)
  const seed = readString(raw.seed)
  const updated_at = readString(raw.updated_at)
  if (!revision || !seed || !updated_at) return undefined
  const inner_nodes = parseInnerNodes(raw.inner_nodes)
  const workstation_count = capOfficeWorkstationCount(
    typeof raw.workstation_count === "number" ? raw.workstation_count : inner_nodes.length,
  )
  const bindings = parseBindings(raw.bindings)
  return {
    schema_version: 1 as const,
    revision,
    seed,
    workstation_count,
    inner_nodes,
    bindings,
    updated_at,
  } satisfies OfficeLayoutSpec
}

export async function computeOfficeLayoutSpec(projectDirectory: string) {
  const missionsText = await Bun.file(path.join(leadDir(projectDirectory), "missions.yaml")).text().catch(() => "schema_version: 1\nmissions: []\n")
  const missionsDoc = parseMissionsFile(missionsText)
  const inner_nodes: OfficeLayoutNode[] = []
  const activeMissionIds = activePortalMissionIds(missionsDoc)
  const layoutMissionIds =
    activeMissionIds.length > 0
      ? activeMissionIds
      : (() => {
          const lingeringId = lingeringPortalMissionId(missionsDoc)
          return lingeringId ? [lingeringId] : []
        })()
  const activeLayout = activeMissionIds.length > 0

  for (const missionId of layoutMissionIds.sort()) {
    const manifest = await readManifest(projectDirectory, missionId)
    if (!manifest) continue
    if (activeLayout && manifest.status !== "running") continue
    for (const nodeId of Object.keys(manifest.nodes).sort()) {
      const node = manifest.nodes[nodeId]
      inner_nodes.push({
        mission_id: missionId,
        node_id: nodeId,
        spawn_id: spawnIdForAgent({
          scope: "inner",
          profile: node?.profile ?? "build",
          nodeId,
          agentId: innerAgentId(missionId, nodeId),
        }),
      })
    }
  }

  const existing = await readOfficeLayoutSpec(projectDirectory)
  const needed = workstationCountForAgents(inner_nodes.length)
  const workstation_count = capOfficeWorkstationCount(
    Math.max(existing?.workstation_count ?? 0, needed),
  )
  const bindings = syncWorkstationBindings(inner_nodes, existing?.bindings, workstation_count)
  const revision = layoutRevisionFromWorkstationCount(workstation_count)
  const now = new Date().toISOString()
  return {
    schema_version: 1,
    revision,
    seed: layoutSeed(revision),
    workstation_count,
    inner_nodes,
    bindings,
    updated_at: now,
  } satisfies OfficeLayoutSpec
}

export async function writeOfficeLayoutSpec(projectDirectory: string, spec: OfficeLayoutSpec) {
  const target = officeLayoutSpecPath(projectDirectory)
  await Bun.$`mkdir -p ${path.dirname(target)}`.quiet()
  await Bun.write(target, stringifyYaml(spec))
}

export async function readOfficeLayoutManifest(projectDirectory: string) {
  const file = Bun.file(path.join(portalOfficeDir(projectDirectory), "manifest.json"))
  if (!(await file.exists())) return undefined
  return (await file.json()) as OfficeLayoutManifest
}

export function isBossOfficeTile(tileX: number, tileY: number) {
  return tileX >= BOSS_OFFICE_ANCHOR_TILE.x && tileX < BOSS_OFFICE_ANCHOR_TILE.x + 13 && tileY >= 0 && tileY < 11
}

export function outerBossAgentIds() {
  return OUTER_BOSS_AGENT_IDS
}

function parseInnerNodes(raw: unknown) {
  if (!Array.isArray(raw)) return [] as OfficeLayoutNode[]
  return raw.flatMap((entry): OfficeLayoutNode[] => {
    if (!isRecord(entry)) return []
    const mission_id = readString(entry.mission_id)
    const node_id = readString(entry.node_id)
    const spawn_id = readString(entry.spawn_id)
    if (!mission_id || !node_id || !spawn_id) return []
    return [{ mission_id, node_id, spawn_id }]
  })
}

function parseBindings(raw: unknown) {
  if (!Array.isArray(raw)) return [] as WorkstationBinding[]
  return raw.flatMap((entry): WorkstationBinding[] => {
    if (!isRecord(entry)) return []
    const spawn_id = readString(entry.spawn_id)
    if (!spawn_id) return []
    const slot = typeof entry.slot === "number" ? entry.slot : undefined
    if (slot === undefined || slot < 0) return []
    return [{ spawn_id, slot }]
  })
}
