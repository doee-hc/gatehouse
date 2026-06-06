import path from "node:path"
import { existsSync } from "node:fs"
import { Grid } from "./grid.ts"
import type { DeskSegmentSpec, ManualMeta, PlacedObject, WorkstationPlacement } from "./types.ts"
import { PythonRandom } from "./python-random.ts"

export function officeLayoutAssetsDir() {
  const bundled = path.join(import.meta.dir, "../../../assets/office-layout-gen/manual_assets")
  if (existsSync(path.join(bundled, "full_office.json"))) return bundled
  return path.resolve(import.meta.dir, "../../../../../pixel_materials/office-layout-gen/manual_assets")
}

export async function loadManualMeta(metaPath: string): Promise<ManualMeta> {
  const raw = (await Bun.file(metaPath).json()) as Record<string, unknown>
  const desk = raw.desk as ManualMeta["desk_segments"] extends never ? never : Record<string, unknown>
  return {
    raw,
    assetsDir: path.dirname(metaPath),
    tile_size: Number(raw.tile_size),
    placement: raw.placement as Record<string, unknown>,
    desk_segments: desk.segments as ManualMeta["desk_segments"],
  }
}

export function rightVariantSpecs(meta: ManualMeta) {
  const base = meta.desk_segments.right
  const shared = Object.fromEntries(
    Object.entries(base).filter(([key]) => !["variants", "id", "texture", "pick", "weights"].includes(key)),
  ) as DeskSegmentSpec
  const variants = base.variants
  if (variants?.length) {
    return variants.map((variant) => {
      const spec = { ...shared, ...variant }
      if (!spec.id) spec.id = path.basename(spec.texture, ".png")
      return spec
    })
  }
  if ("texture" in base && base.texture) return [base as DeskSegmentSpec]
  throw new Error("desk.segments.right needs variants[] or texture")
}

function weightedChoice(rng: PythonRandom, specs: DeskSegmentSpec[], base: ManualMeta["desk_segments"]["right"]) {
  const weights = base.weights
  if (weights && weights.length === specs.length) {
    const total = weights.reduce((sum, w) => sum + w, 0)
    let roll = rng.random() * total
    for (let i = 0; i < specs.length; i++) {
      roll -= weights[i]!
      if (roll <= 0) return specs[i]!
    }
    return specs[specs.length - 1]!
  }
  return rng.choice(specs)
}

export function pickRightVariant(meta: ManualMeta, rng: PythonRandom) {
  const specs = rightVariantSpecs(meta)
  const base = meta.desk_segments.right
  if (base.pick === "random" && specs.length > 1) return weightedChoice(rng, specs, base)
  return specs[0]!
}

export function rowWidthTiles(meta: ManualMeta, rightSegments?: number) {
  const n = rightSegments ?? Number(meta.placement.right_segments ?? 1)
  const left = meta.desk_segments.left
  const rightW = Number(meta.desk_segments.right.width_tiles)
  return left.width_tiles + rightW * Math.max(1, n)
}

function markSegmentTiles(grid: Grid, originX: number, originY: number, spec: DeskSegmentSpec) {
  const w = spec.width_tiles
  const h = spec.height_tiles
  for (let dy = 1; dy < h; dy++) {
    const blockY = originY + dy
    for (let dx = 0; dx < w; dx++) {
      grid.markBlockedRect(originX + dx, blockY, 1, 1, new Set(["desk", "blocked"]))
    }
  }
}

function placeSprite(
  objectsOut: PlacedObject[],
  objectId: string,
  originX: number,
  originY: number,
  spec: DeskSegmentSpec,
  tileSize: number,
) {
  const anchor = spec.anchor_pixel ?? [0, 0]
  objectsOut.push({
    object_id: objectId,
    x: originX * tileSize + anchor[0],
    y: originY * tileSize + anchor[1],
    facing: "down",
  })
}

function placeChairOnSegment(
  grid: Grid,
  meta: ManualMeta,
  key: "chair_front" | "chair_back",
  segmentX: number,
  anchorY: number,
  objectsOut: PlacedObject[],
  includeBackChair: boolean,
) {
  const spec = meta.raw[key] as Record<string, unknown> | undefined
  if (!spec) return
  if (key === "chair_back" && !includeBackChair) return
  const ts = meta.tile_size
  const cx = segmentX + Number(spec.tile_x)
  const cy = anchorY + Number(spec.tile_y)
  const cw = Number(spec.width_tiles ?? 1)
  const ch = Number(spec.height_tiles ?? 2)
  for (let dy = 0; dy < ch; dy++) {
    for (let dx = 0; dx < cw; dx++) {
      const tx = cx + dx
      const ty = cy + dy
      if (grid.inBounds(tx, ty)) grid.get(tx, ty).tags.add("chair")
    }
  }
  objectsOut.push({
    object_id: key,
    x: cx * ts,
    y: cy * ts,
    facing: String(spec.facing ?? "down"),
  })
}

export function applyManualWorkstation(
  grid: Grid,
  meta: ManualMeta,
  anchorX: number,
  anchorY: number,
  options: {
    right_segments?: number
    include_back_chair?: boolean
    rng?: PythonRandom
  } = {},
): WorkstationPlacement {
  const p = meta.placement
  const nRight = Math.max(1, options.right_segments ?? Number(p.right_segments ?? 1))
  const includeBackChair = options.include_back_chair ?? Boolean(p.include_back_chair ?? false)
  const roll = options.rng ?? new PythonRandom(0)

  const left = meta.desk_segments.left
  const rightW = meta.desk_segments.right.width_tiles
  const leftW = left.width_tiles
  const objectsOut: PlacedObject[] = []

  markSegmentTiles(grid, anchorX, anchorY, left)
  placeSprite(objectsOut, left.id, anchorX, anchorY, left, meta.tile_size)

  for (let i = 0; i < nRight; i++) {
    const right = pickRightVariant(meta, roll)
    const sx = anchorX + leftW + i * rightW
    markSegmentTiles(grid, sx, anchorY, right)
    placeSprite(objectsOut, right.id, sx, anchorY, right, meta.tile_size)
    placeChairOnSegment(grid, meta, "chair_front", sx, anchorY, objectsOut, includeBackChair)
    placeChairOnSegment(grid, meta, "chair_back", sx, anchorY, objectsOut, includeBackChair)
  }

  return { anchor_x: anchorX, anchor_y: anchorY, objects: objectsOut }
}
