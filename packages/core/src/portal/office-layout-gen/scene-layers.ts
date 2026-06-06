import path from "node:path"
import { TILE, type DrawSprite, type PlacedObject, type SceneLayer } from "./types.ts"
import { readPngFile } from "./png.ts"

const FOREGROUND_SPRITE_IDS = new Set(["full_front_wall", "boss_front_wall"])

export function entryTopLeftPx(entry: SceneLayer, anchor: [number, number] | null) {
  const [tx, ty] = entry.tile
  if (entry.scope === "map" || anchor === null) return [tx * TILE, ty * TILE] as const
  const [ax, ay] = anchor
  return [(ax + tx) * TILE, (ay + ty) * TILE] as const
}

export function entryDrawDepth(entry: SceneLayer, py: number, imageHeight: number) {
  if (entry.backdrop || entry.id === "background") return -1
  return spriteDepth(py, imageHeight)
}

export function spriteDepth(py: number, height: number) {
  return py + height
}

export async function openLayerImage(entry: SceneLayer, assetsDir: string) {
  return readPngFile(path.join(assetsDir, entry.texture))
}

export function splitMapLayers(mapLayers: SceneLayer[]) {
  const back: SceneLayer[] = []
  const front: SceneLayer[] = []
  for (const entry of mapLayers) {
    if (entry.backdrop || entry.id === "background") back.push(entry)
    else front.push(entry)
  }
  return { back, front }
}

export async function layerDrawables(
  layers: SceneLayer[],
  assetsDir: string,
  anchor: [number, number] | null,
) {
  const out: DrawSprite[] = []
  for (const entry of layers) {
    const kind = entry.type ?? "sprite"
    if (!["chair", "desk", "sprite"].includes(kind)) continue
    const image = await openLayerImage(entry, assetsDir)
    const [px, py] = entryTopLeftPx(entry, anchor)
    out.push({
      image,
      x: px,
      y: py,
      depth: entryDrawDepth(entry, py, image.height),
      label: entry.id ?? entry.texture,
    })
  }
  return out
}

export function portalLayeredObject(objectId: string) {
  if (objectId === "chair_front" || objectId === "chair_back" || objectId === "desk_left") return true
  return objectId.startsWith("desk_right")
}

export function orderPlacedForExport(objects: PlacedObject[]) {
  const backdrop = objects.filter((obj) => obj.object_id === "background")
  const walls = objects.filter((obj) => FOREGROUND_SPRITE_IDS.has(obj.object_id))
  const rest = objects.filter((obj) => !backdrop.includes(obj) && !walls.includes(obj))
  return [...backdrop, ...rest, ...walls]
}
