import { tiledObjectProp } from "./tiled-props.ts"

const BOSS_CHAIR_HEIGHT = 64
const BOSS_TOP_CHAIR_SORT_FROM_TOP = 48

export function layoutDecorTextureKey(texture: string) {
  return `office-decor-${texture}`
}

const TOP_ROW_DECOR = new Set(["tl", "tr", "tl_chair", "tr_chair"])

function bossRowForDecor(name: string) {
  if (TOP_ROW_DECOR.has(name)) return "top" as const
  if (name === "dl" || name === "dr" || name === "dl_chair" || name === "dr_chair") return "bottom" as const
  return undefined
}

export function depthForInnerDecor(
  decorKind: string,
  y: number,
  spriteH: number,
  sortAnchor?: string,
  deskSortDepth?: number,
) {
  if (decorKind === "desk") {
    const deskBottom = deskSortDepth ?? y + spriteH
    return 10 + deskBottom + 0.2
  }
  if (decorKind === "chair") {
    if (sortAnchor === "top") return 10 + y + 0.2
    return 10 + y + spriteH + 0.2
  }
  return 10 + y + spriteH
}

export function depthForDecorObject(
  decorKind: string,
  depthSortY: number,
  bossRow?: "top" | "bottom",
  deskBottomY?: number,
) {
  if (bossRow === "top") {
    if (decorKind === "chair") {
      return 10 + depthSortY - (BOSS_CHAIR_HEIGHT - BOSS_TOP_CHAIR_SORT_FROM_TOP) - 0.2
    }
    if (decorKind === "desk") return 10 + (deskBottomY ?? depthSortY) + 0.2
    return 10 + depthSortY
  }
  if (bossRow === "bottom") {
    const base = 10 + depthSortY
    if (decorKind === "chair") return base + 0.2
    if (decorKind === "desk") return base - 0.2
    return base
  }
  const base = 10 + depthSortY
  if (decorKind === "chair") return base + 0.2
  if (decorKind === "desk") return base - 0.2
  return base
}

export function spawnLayoutDecor(
  scene: Phaser.Scene,
  map: Phaser.Tilemaps.Tilemap,
  decorSprites: Map<string, Phaser.GameObjects.Sprite>,
) {
  const decor = map.getObjectLayer("decor")
  if (!decor) return

  for (const obj of decor.objects) {
    if (obj.type !== "decor") continue
    const texture = tiledObjectProp(obj, "texture")
    const decorKind = tiledObjectProp(obj, "decorKind")
    if (typeof texture !== "string" || typeof decorKind !== "string") continue
    if (typeof obj.x !== "number" || typeof obj.y !== "number") continue
    const depthSortY = tiledObjectProp(obj, "depthSortY")
    const key = layoutDecorTextureKey(texture)
    if (!scene.textures.exists(key)) continue
    const source = scene.textures.get(key).getSourceImage() as { width: number; height: number }
    const spriteH = source.height || obj.height || 64
    const deskBottomY = obj.y + spriteH
    const sortY = typeof depthSortY === "number" ? depthSortY : deskBottomY
    const innerZone = tiledObjectProp(obj, "innerZone") === "true" || tiledObjectProp(obj, "innerZone") === true
    const sortAnchorRaw = tiledObjectProp(obj, "sortAnchor")
    const sortAnchor = typeof sortAnchorRaw === "string" ? sortAnchorRaw : undefined
    const deskSortDepthRaw = tiledObjectProp(obj, "deskSortDepth")
    const deskSortDepth = typeof deskSortDepthRaw === "number" ? deskSortDepthRaw : undefined
    const bossRow = innerZone ? undefined : bossRowForDecor(obj.name ?? "")
    const depth = innerZone
      ? depthForInnerDecor(decorKind, obj.y, spriteH, sortAnchor, deskSortDepth)
      : depthForDecorObject(decorKind, sortY, bossRow, deskBottomY)
    const sprite = scene.add
      .sprite(obj.x, obj.y, key)
      .setOrigin(0, 0)
      .setDepth(depth)
    if (scene.textures.exists(key)) scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST)
    const chairId = tiledObjectProp(obj, "chairId")
    if (typeof chairId === "string") decorSprites.set(chairId, sprite)
  }
}
