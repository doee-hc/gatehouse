import path from "node:path"
import { Grid } from "./grid.ts"
import { initFloorGrid, placeCubicleClusters, placementGridOptions } from "./cubicle-clusters.ts"
import { loadManualMeta } from "./manual-workstation.ts"
import { PythonRandom } from "./python-random.ts"
import { capOfficeWorkstationCount } from "../office-layout.ts"
import { readOfficeLayoutPreset } from "./preset-layouts.ts"
import type { ClusterPlacement, ManualMeta, SceneJson } from "./types.ts"

async function loadSceneJson(scenePath: string) {
  return (await Bun.file(scenePath).json()) as SceneJson
}

export type CubicleLayoutResult = {
  placements: ClusterPlacement[]
  warnings: string[]
  fromPreset: boolean
}

export async function resolveCubiclePlacements(
  assetsDir: string,
  seatCount: number,
  seed: number,
  options: { skipPreset?: boolean } = {},
): Promise<CubicleLayoutResult> {
  if (seatCount <= 0) return { placements: [], warnings: [], fromPreset: false }

  const layoutCount = capOfficeWorkstationCount(seatCount)

  if (!options.skipPreset) {
    const preset = await readOfficeLayoutPreset(layoutCount)
    if (preset) {
      return { placements: preset.placements, warnings: [...preset.collision.warnings], fromPreset: true }
    }
  }

  const scenePath = path.join(assetsDir, "full_office.json")
  const scene = await loadSceneJson(scenePath)
  const meta = await loadManualMeta(path.join(assetsDir, scene.cubicle_meta ?? "meta.json"))
  const [mapW, mapH] = scene.map_size ?? [37, 21]
  const gridOpts = placementGridOptions(scene)
  const placementGrid = initFloorGrid(mapW, mapH, scene.boss_exclusion, {
    wall_clearance: gridOpts.wall_clearance,
    front_wall_top_row: gridOpts.front_wall_top_row,
    map_layers: scene.map_layers,
  })
  const rng = new PythonRandom(seed)
  const clusterCfg = scene.cluster ?? {}
  const { placements, warnings } = placeCubicleClusters(placementGrid, meta, layoutCount, rng, {
    min_segments: clusterCfg.min_segments ?? 2,
    max_segments: clusterCfg.max_segments ?? 5,
    aisle_tiles: clusterCfg.aisle_tiles ?? 1,
    include_back_chair: Boolean(meta.placement.include_back_chair ?? false),
    layout_attempts: clusterCfg.layout_attempts ?? 24,
  })
  return { placements, warnings, fromPreset: false }
}

export async function loadLayoutSceneContext(assetsDir: string) {
  const scenePath = path.join(assetsDir, "full_office.json")
  const scene = await loadSceneJson(scenePath)
  const meta = await loadManualMeta(path.join(assetsDir, scene.cubicle_meta ?? "meta.json"))
  const [mapW, mapH] = scene.map_size ?? [37, 21]
  return { scene, meta, mapW, mapH }
}

export function markWorkstationDesksOnGrid(
  walk: Grid,
  meta: ManualMeta,
  placements: ClusterPlacement[],
) {
  const left = meta.desk_segments.left
  const right = meta.desk_segments.right
  for (const placement of placements) {
    const [ax, ay] = placement.anchor
    markDeskBlockedRows(walk, ax, ay, left.width_tiles, left.height_tiles)
    for (let i = 0; i < placement.right_segments; i++) {
      const sx = ax + left.width_tiles + i * right.width_tiles
      markDeskBlockedRows(walk, sx, ay, right.width_tiles, right.height_tiles)
    }
  }
}

function markDeskBlockedRows(walk: Grid, tx: number, ty: number, wTiles: number, hTiles: number) {
  for (let dy = 1; dy < hTiles; dy++) {
    const blockY = ty + dy
    for (let dx = 0; dx < wTiles; dx++) {
      if (!walk.inBounds(tx + dx, blockY)) continue
      walk.get(tx + dx, blockY).blocked = true
      walk.get(tx + dx, blockY).tags.add("desk")
    }
  }
}

export function markChairWalkableOnGrid(
  walk: Grid,
  meta: ManualMeta,
  placements: ClusterPlacement[],
) {
  for (const placement of placements) {
    for (const obj of placement.objects) {
      if (obj.object_id !== "chair_front" && obj.object_id !== "chair_back") continue
      const spec = meta.raw[obj.object_id] as { width_tiles?: number; height_tiles?: number } | undefined
      if (!spec) continue
      const cx = Math.floor(obj.x / 32)
      const cy = Math.floor(obj.y / 32)
      const cw = Number(spec.width_tiles ?? 1)
      const ch = Number(spec.height_tiles ?? 2)
      for (let dy = 0; dy < ch; dy++) {
        for (let dx = 0; dx < cw; dx++) {
          const tx = cx + dx
          const ty = cy + dy
          if (!walk.inBounds(tx, ty)) continue
          const cell = walk.get(tx, ty)
          if (cell.tags.has("desk")) continue
          cell.blocked = false
          cell.tags.add("chair")
        }
      }
    }
  }
}
