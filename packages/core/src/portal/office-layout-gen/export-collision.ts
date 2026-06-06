import path from "node:path"
import { Grid } from "./grid.ts"
import { placementGridOptions } from "./cubicle-clusters.ts"
import { deskTileSize } from "./png.ts"
import { loadScene } from "./scene-compose.ts"
import {
  markChairWalkableOnGrid,
  markWorkstationDesksOnGrid,
  resolveCubiclePlacements,
} from "./cubicle-layout.ts"
import { capOfficeWorkstationCount } from "../office-layout.ts"
import { readOfficeLayoutPreset } from "./preset-layouts.ts"
import { loadManualMeta, rightVariantSpecs } from "./manual-workstation.ts"
import { TILE, type ClusterPlacement, type InnerChairSlot, type InnerDecorEntry, type ManualMeta, type PortalCollisionExport, type PlacedObject } from "./types.ts"

function markCell(walk: Grid, tx: number, ty: number) {
  if (!walk.inBounds(tx, ty)) return
  const cell = walk.get(tx, ty)
  cell.blocked = true
  cell.tags.add("wall")
}

function markRect(walk: Grid, x0: number, y0: number, x1: number, y1: number) {
  for (let ty = Math.min(y0, y1); ty <= Math.max(y0, y1); ty++) {
    for (let tx = Math.min(x0, x1); tx <= Math.max(x0, x1); tx++) markCell(walk, tx, ty)
  }
}

function markWalkWalls(
  walk: Grid,
  spec?: {
    rows?: number[]
    cols?: number[]
    segments?: { x0: number; y0: number; x1: number; y1: number }[]
  },
) {
  if (!spec) return
  for (const row of spec.rows ?? []) {
    for (let tx = 0; tx < walk.width; tx++) markCell(walk, tx, row)
  }
  for (const col of spec.cols ?? []) {
    for (let ty = 0; ty < walk.height; ty++) markCell(walk, col, ty)
  }
  for (const segment of spec.segments ?? []) {
    markRect(walk, segment.x0, segment.y0, segment.x1, segment.y1)
  }
}

function markFrontWall(grid: Grid, frontRow: number) {
  for (let ty = Math.max(0, frontRow); ty < grid.height; ty++) {
    for (let tx = 0; tx < grid.width; tx++) {
      const cell = grid.get(tx, ty)
      cell.blocked = true
      cell.tags.add("wall")
    }
  }
}

async function markBossDesks(walk: Grid, bossLayout: Record<string, unknown>, assetsDir: string) {
  const anchor = bossLayout.anchor_tile as [number, number]
  const layers = (bossLayout.layers ?? []) as { type?: string; tile?: [number, number]; texture?: string }[]
  for (const entry of layers) {
    if (entry.type !== "desk") continue
    const tile = entry.tile ?? [0, 0]
    const tx = anchor[0] + tile[0]
    const ty = anchor[1] + tile[1]
    const [wTiles, hTiles] = await deskTileSize(assetsDir, String(entry.texture ?? ""))
    for (let dy = 1; dy < hTiles; dy++) {
      const blockY = ty + dy
      for (let dx = 0; dx < wTiles; dx++) {
        if (!walk.inBounds(tx + dx, blockY)) continue
        walk.get(tx + dx, blockY).blocked = true
        walk.get(tx + dx, blockY).tags.add("desk")
      }
    }
  }
}

function deskTexture(meta: ManualMeta, objectId: string) {
  const left = meta.desk_segments.left
  if (objectId === left.id) return left.texture
  for (const spec of rightVariantSpecs(meta)) {
    if (spec.id === objectId) return spec.texture
  }
  return undefined
}

function innerWorkstationDecor(placements: ClusterPlacement[], meta: ManualMeta) {
  const deskHeightTiles = meta.desk_segments.left.height_tiles
  const chairFrontTex = String((meta.raw.chair_front as { texture: string }).texture)
  const chairBackTex = String((meta.raw.chair_back as { texture: string }).texture)
  const decor: InnerDecorEntry[] = []
  const fronts: [PlacedObject, number][] = []
  const backs = new Map<string, [PlacedObject, number]>()
  let slot = 0

  for (const placement of placements) {
    const ay = placement.anchor[1]
    const deskSortY = (ay + deskHeightTiles) * TILE
    for (const obj of placement.objects) {
      const oid = obj.object_id
      if (oid === "desk_left" || oid.startsWith("desk_right")) {
        const texture = deskTexture(meta, oid)
        if (texture) {
          decor.push({
            decorKind: "desk",
            texture,
            x: obj.x,
            y: obj.y,
            deskSortDepth: deskSortY,
            innerZone: true,
          })
        }
        continue
      }
      if (oid === "chair_front") fronts.push([obj, deskSortY])
      if (oid === "chair_back") backs.set(`${obj.x},${obj.y}`, [obj, deskSortY])
    }
  }

  fronts.sort((a, b) => a[0].y - b[0].y || a[0].x - b[0].x)
  for (const [front, deskSortY] of fronts) {
    decor.push({
      decorKind: "chair",
      texture: chairFrontTex,
      x: front.x,
      y: front.y,
      chairId: `inner-${slot}`,
      deskSortDepth: deskSortY,
      sortAnchor: "bottom",
      innerZone: true,
    })
    slot++
    const backEntry = backs.get(`${front.x},${front.y - TILE * 3}`)
    if (backEntry) {
      const [back, backDeskSortY] = backEntry
      decor.push({
        decorKind: "chair",
        texture: chairBackTex,
        x: back.x,
        y: back.y,
        chairId: `inner-${slot}`,
        deskSortDepth: backDeskSortY,
        sortAnchor: "top",
        innerZone: true,
      })
      slot++
    }
  }
  return decor
}

function innerChairSlots(placements: ClusterPlacement[], meta: ManualMeta) {
  const deskHeightTiles = meta.desk_segments.left.height_tiles
  const fronts: [PlacedObject, number][] = []
  const backs = new Map<string, [PlacedObject, number]>()
  for (const placement of placements) {
    const ay = placement.anchor[1]
    const deskSortY = (ay + deskHeightTiles) * TILE
    for (const obj of placement.objects) {
      if (obj.object_id === "chair_front") fronts.push([obj, deskSortY])
      if (obj.object_id === "chair_back") backs.set(`${obj.x},${obj.y}`, [obj, deskSortY])
    }
  }
  fronts.sort((a, b) => a[0].y - b[0].y || a[0].x - b[0].x)
  const slots: InnerChairSlot[] = []
  for (const [front, deskSortY] of fronts) {
    slots.push({ kind: "front", x: front.x, y: front.y, facing: "up", deskSortDepth: deskSortY })
    const backEntry = backs.get(`${front.x},${front.y - TILE * 3}`)
    if (backEntry) {
      const [back, backDeskSortY] = backEntry
      slots.push({ kind: "back", x: back.x, y: back.y, facing: "down", deskSortDepth: backDeskSortY })
    }
  }
  return slots
}

export async function exportPortalCollision(
  assetsDir: string,
  options: { workstation_count?: number; seed?: number; skipPreset?: boolean } = {},
): Promise<PortalCollisionExport> {
  const seatCount = capOfficeWorkstationCount(Number(options.workstation_count ?? 0))
  const seed = Number(options.seed ?? 0)

  if (!options.skipPreset) {
    const preset = await readOfficeLayoutPreset(seatCount)
    if (preset) return preset.collision
  }

  const scenePath = path.join(assetsDir, "full_office.json")
  const scene = await loadScene(scenePath)
  const [mapW, mapH] = scene.map_size ?? [37, 21]
  const gridOpts = placementGridOptions(scene)
  const frontRow = gridOpts.front_wall_top_row ?? 19

  const walk = new Grid(mapW, mapH)
  markWalkWalls(walk, scene.walk_walls)
  markFrontWall(walk, frontRow)

  const meta = await loadManualMeta(path.join(assetsDir, scene.cubicle_meta ?? "meta.json"))
  const warnings: string[] = []
  let chairs: InnerChairSlot[] = []
  let decor: InnerDecorEntry[] = []

  if (seatCount > 0) {
    const { placements, warnings: placementWarnings } = await resolveCubiclePlacements(
      assetsDir,
      seatCount,
      seed,
      { skipPreset: options.skipPreset },
    )
    warnings.push(...placementWarnings)
    chairs = innerChairSlots(placements, meta)
    decor = innerWorkstationDecor(placements, meta)
    markWorkstationDesksOnGrid(walk, meta, placements)
    markChairWalkableOnGrid(walk, meta, placements)
  }

  const bossLayout = (await Bun.file(path.join(assetsDir, scene.boss_office ?? "boss_office.json")).json()) as Record<
    string,
    unknown
  >
  await markBossDesks(walk, bossLayout, assetsDir)

  const blocked = Array.from({ length: mapH }, (_, ty) =>
    Array.from({ length: mapW }, (_, tx) => walk.get(tx, ty).blocked),
  )

  return { width: mapW, height: mapH, blocked, chairs, decor, warnings }
}

/** Build collision export + cluster placements (for preset baking). */
export async function exportPortalCollisionForBake(
  assetsDir: string,
  options: { workstation_count: number; seed: number },
) {
  const seatCount = capOfficeWorkstationCount(options.workstation_count)
  const seed = options.seed
  const scenePath = path.join(assetsDir, "full_office.json")
  const scene = await loadScene(scenePath)
  const [mapW, mapH] = scene.map_size ?? [37, 21]
  const gridOpts = placementGridOptions(scene)
  const frontRow = gridOpts.front_wall_top_row ?? 19

  const walk = new Grid(mapW, mapH)
  markWalkWalls(walk, scene.walk_walls)
  markFrontWall(walk, frontRow)

  const meta = await loadManualMeta(path.join(assetsDir, scene.cubicle_meta ?? "meta.json"))
  const warnings: string[] = []
  let chairs: InnerChairSlot[] = []
  let decor: InnerDecorEntry[] = []
  let placements: ClusterPlacement[] = []

  if (seatCount > 0) {
    const resolved = await resolveCubiclePlacements(assetsDir, seatCount, seed, { skipPreset: true })
    placements = resolved.placements
    warnings.push(...resolved.warnings)
    chairs = innerChairSlots(placements, meta)
    decor = innerWorkstationDecor(placements, meta)
    markWorkstationDesksOnGrid(walk, meta, placements)
    markChairWalkableOnGrid(walk, meta, placements)
  }

  const bossLayout = (await Bun.file(path.join(assetsDir, scene.boss_office ?? "boss_office.json")).json()) as Record<
    string,
    unknown
  >
  await markBossDesks(walk, bossLayout, assetsDir)

  const blocked = Array.from({ length: mapH }, (_, ty) =>
    Array.from({ length: mapW }, (_, tx) => walk.get(tx, ty).blocked),
  )

  const collision = { width: mapW, height: mapH, blocked, chairs, decor, warnings } satisfies PortalCollisionExport
  return { collision, placements, warnings }
}

export { innerChairSlots, innerWorkstationDecor }
