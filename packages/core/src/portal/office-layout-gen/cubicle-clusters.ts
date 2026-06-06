import { Grid } from "./grid.ts"
import type { ClusterPlacement, ManualMeta, SceneJson } from "./types.ts"
import { PythonRandom } from "./python-random.ts"
import { applyManualWorkstation, rowWidthTiles } from "./manual-workstation.ts"

function markExclusionRect(grid: Grid, x: number, y: number, w: number, h: number) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      if (grid.inBounds(x + dx, y + dy)) {
        const cell = grid.get(x + dx, y + dy)
        cell.blocked = true
        cell.tags.add("excluded")
      }
    }
  }
}

function frontWallTopRow(mapLayers: SceneJson["map_layers"]) {
  if (!mapLayers) return undefined
  for (const entry of mapLayers) {
    if (entry.id === "full_front_wall") return entry.tile[1]
  }
  return undefined
}

export function placementGridOptions(scene: SceneJson | null | undefined, defaultWallClearance = 1) {
  const cluster = scene?.cluster ?? {}
  return {
    wall_clearance: Number(cluster.wall_clearance_tiles ?? defaultWallClearance),
    front_wall_top_row: frontWallTopRow(scene?.map_layers),
  }
}

function markWallClearanceBands(grid: Grid, clearance: number, frontWallTopRow?: number) {
  if (clearance < 1) return
  const w = grid.width
  const h = grid.height
  markExclusionRect(grid, 1, 0, clearance, h)
  markExclusionRect(grid, w - clearance - 1, 0, clearance, h)
  markExclusionRect(grid, 0, 1, w, clearance)
  let bottomStart = h - clearance - 1
  if (frontWallTopRow !== undefined) bottomStart = Math.min(bottomStart, Math.max(0, frontWallTopRow - clearance))
  if (bottomStart < h) markExclusionRect(grid, 0, bottomStart, w, h - bottomStart)
}

export function initFloorGrid(
  width: number,
  height: number,
  exclusion: SceneJson["boss_exclusion"],
  options: {
    wall_clearance?: number
    front_wall_top_row?: number
    map_layers?: SceneJson["map_layers"]
  } = {},
) {
  let frontRow = options.front_wall_top_row
  if (frontRow === undefined && options.map_layers) frontRow = frontWallTopRow(options.map_layers)

  const grid = new Grid(width, height)
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const cell = grid.get(tx, ty)
      const onBorder = tx === 0 || ty === 0 || tx === width - 1 || ty === height - 1
      if (onBorder) {
        cell.blocked = true
        cell.tags.add("wall")
      } else {
        cell.tags.add("floor")
        cell.tags.add("walkable")
      }
    }
  }

  markWallClearanceBands(grid, options.wall_clearance ?? 0, frontRow)

  if (exclusion) {
    const [ax, ay] = exclusion.anchor
    const [bw, bh] = exclusion.size
    const pad = Number(exclusion.padding ?? 1)
    markExclusionRect(grid, ax - pad, ay - pad, bw + pad * 2, bh + pad * 2)
  }
  return grid
}

export function planClusterSizes(
  seatCount: number,
  rng: PythonRandom,
  options: { min_segments?: number; max_segments?: number } = {},
) {
  if (seatCount < 1) return []
  const minSegments = options.min_segments ?? 2
  const maxSegments = options.max_segments ?? 6
  const sizes: number[] = []
  let remaining = seatCount
  while (remaining > 0) {
    const hi = Math.min(maxSegments, remaining)
    const lo = Math.min(minSegments, hi)
    const k = remaining <= hi ? remaining : rng.randint(lo, Math.min(hi, Math.max(lo, maxSegments - 1)))
    sizes.push(k)
    remaining -= k
  }
  return sizes
}

function footprint(meta: ManualMeta, rightSegments: number, aisle: number) {
  return {
    w: rowWidthTiles(meta, rightSegments),
    h: Number(meta.placement.module_height_tiles) + Math.max(0, aisle),
  }
}

function pickAnchor(
  grid: Grid,
  meta: ManualMeta,
  rightSegments: number,
  rng: PythonRandom,
  aisle: number,
  centers: [number, number][],
) {
  const { w, h } = footprint(meta, rightSegments, aisle)
  const candidates: [number, number, number][] = []
  for (let y = 0; y <= grid.height - h; y++) {
    for (let x = 0; x <= grid.width - w; x++) {
      if (!grid.canPlaceRect(x, y, w, h)) continue
      const cx = x + w / 2
      const cy = y + h / 2
      const dist =
        centers.length > 0
          ? Math.min(...centers.map(([px, py]) => Math.hypot(cx - px, cy - py)))
          : 0
      const score = dist + rng.random() * 8
      candidates.push([x, y, score])
    }
  }
  if (candidates.length === 0) return undefined
  candidates.sort((a, b) => b[2] - a[2])
  const top = candidates.slice(0, Math.min(24, candidates.length))
  return rng.choice(top)
}

function reserveAisle(grid: Grid, x: number, y: number, w: number, h: number, pad: number) {
  for (let dy = -pad; dy < h + pad; dy++) {
    for (let dx = -pad; dx < w + pad; dx++) {
      const nx = x + dx
      const ny = y + dy
      if (grid.inBounds(nx, ny)) grid.get(nx, ny).tags.add("aisle")
    }
  }
}

function placeWithSizes(
  grid: Grid,
  meta: ManualMeta,
  sizes: number[],
  rng: PythonRandom,
  aisleTiles: number,
  includeBackChair: boolean | undefined,
) {
  const placements: ClusterPlacement[] = []
  const centers: [number, number][] = []
  let placedSeats = 0
  const sorted = [...sizes].sort((a, b) => b - a)
  for (const rightSegments of sorted) {
    const anchor = pickAnchor(grid, meta, rightSegments, rng, aisleTiles, centers)
    if (!anchor) continue
    const [ax, ay] = anchor
    const { w, h } = footprint(meta, rightSegments, 0)
    const wp = applyManualWorkstation(grid, meta, ax, ay, {
      right_segments: rightSegments,
      include_back_chair: includeBackChair,
      rng,
    })
    reserveAisle(grid, ax, ay, w, h, aisleTiles)
    centers.push([ax + w / 2, ay + h / 2])
    placements.push({ anchor: [ax, ay], right_segments: rightSegments, objects: wp.objects })
    placedSeats += rightSegments
  }
  return { placements, placedSeats }
}

export function placeCubicleClusters(
  grid: Grid,
  meta: ManualMeta,
  seatCount: number,
  rng: PythonRandom,
  options: {
    min_segments?: number
    max_segments?: number
    aisle_tiles?: number
    include_back_chair?: boolean
    layout_attempts?: number
  } = {},
) {
  const warnings: string[] = []
  let best: ClusterPlacement[] = []
  let bestCount = 0
  const layoutAttempts = options.layout_attempts ?? 24

  for (let attempt = 0; attempt < layoutAttempts; attempt++) {
    const trial = grid.clone()
    const sizes = planClusterSizes(seatCount, rng, {
      min_segments: options.min_segments,
      max_segments: options.max_segments,
    })
    rng.shuffle(sizes)
    const { placements, placedSeats } = placeWithSizes(
      trial,
      meta,
      sizes,
      rng,
      options.aisle_tiles ?? 2,
      options.include_back_chair,
    )
    if (placedSeats > bestCount) {
      best = placements
      bestCount = placedSeats
    }
    if (placedSeats >= seatCount) return { placements, warnings }
  }

  if (bestCount < seatCount) {
    warnings.push(
      `Placed ${bestCount}/${seatCount} cubicle seats; try fewer workstations, a larger map, or smaller wall_clearance_tiles.`,
    )
  }
  return { placements: best, warnings }
}
