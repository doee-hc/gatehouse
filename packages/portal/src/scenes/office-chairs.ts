import type { Facing } from "../office/character-anims.ts"
import { officeTileSize } from "../office/office-tile-size.ts"
import type { GridPoint } from "../pathfinding/astar.ts"
import { worldToGrid } from "../pathfinding/path-move.ts"
import { tiledObjectProp } from "./tiled-props.ts"

export type ChairSpot = {
  id: string
  propId: string
  nodeX: number
  nodeY: number
  sitWorld: { x: number; y: number }
  sitGrid: GridPoint
  sitDirection: Facing
  spriteCenter: { x: number; y: number }
  deskSortDepth?: number
  chairSortDepth?: number
}

const CHAIR_PROPS = new Set(["chair_back", "chair_front", "chair_side"])

const BOSS_CHAIR_HEIGHT = 64
const BOSS_TOP_CHAIR_SORT_FROM_TOP = 48
const INNER_CHAIR_HEIGHT = 64
const INNER_SIT_PIXEL_LIFT = 8
const INNER_SIT_ANCHOR_DOWN_NUDGE = 4

function chairSitTileOffsetY(sitDirection: Facing) {
  const base = sitDirection === "down" ? 0.5 : 1
  return base - 0.25
}

function chairSitOffsetForDirection(sitDirection: Facing) {
  if (sitDirection === "down") return { sitX: 16, sitY: 48 }
  return { sitX: 16, sitY: 12 }
}

function isInnerChair(chair: ChairSpot) {
  return chair.id.startsWith("inner-")
}

export function agentSitWorld(chair: ChairSpot) {
  if (!isInnerChair(chair)) return chair.sitWorld
  const sit = chairSitOffsetForDirection(chair.sitDirection)
  const tile = officeTileSize
  return {
    x: chair.nodeX + sit.sitX,
    y:
      chair.nodeY +
      sit.sitY +
      chairSitTileOffsetY(chair.sitDirection) * tile -
      INNER_SIT_PIXEL_LIFT +
      INNER_SIT_ANCHOR_DOWN_NUDGE,
  }
}

function bossTopRowChairSortY(chair: ChairSpot) {
  return chair.nodeY + BOSS_TOP_CHAIR_SORT_FROM_TOP
}

function bossTopRowChairDepth(chair: ChairSpot) {
  return 10 + bossTopRowChairSortY(chair) - 0.2
}

function isBossTopRow(chair: ChairSpot) {
  return chair.id.startsWith("boss-") && chair.propId === "chair_back"
}

export function innerChairBottomY(chair: ChairSpot) {
  return chair.nodeY + INNER_CHAIR_HEIGHT
}

export function depthForInnerChair(chair: ChairSpot) {
  if (chair.sitDirection === "up") return 10 + innerChairBottomY(chair) + 0.2
  return 10 + chair.nodeY + 0.2
}

export function parseFacing(raw: unknown): Facing {
  if (raw === "up" || raw === "down" || raw === "left" || raw === "right") return raw
  return "down"
}

export function readChairSpots(map: Phaser.Tilemaps.Tilemap) {
  const chairs = new Map<string, ChairSpot>()
  const furniture = map.getObjectLayer("furniture")
  if (!furniture) return chairs

  for (const obj of furniture.objects) {
    if (obj.type !== "furniture") continue
    const propId = tiledObjectProp(obj, "propId")
    if (typeof propId !== "string" || !CHAIR_PROPS.has(propId)) continue
    const chairId = tiledObjectProp(obj, "chairId")
    if (typeof chairId !== "string") continue
    const nodeX = tiledObjectProp(obj, "chairNodeX")
    const nodeY = tiledObjectProp(obj, "chairNodeY")
    const sitX = tiledObjectProp(obj, "sitX")
    const sitY = tiledObjectProp(obj, "sitY")
    if (typeof nodeX !== "number" || typeof nodeY !== "number") continue
    if (typeof sitX !== "number" || typeof sitY !== "number") continue
    const sitWorldX = nodeX + sitX
    const sitWorldY = nodeY + sitY
    const deskSortDepth = tiledObjectProp(obj, "deskSortDepth")
    const chairSortDepth = tiledObjectProp(obj, "chairSortDepth")
    chairs.set(chairId, {
      id: chairId,
      propId,
      nodeX,
      nodeY,
      sitWorld: { x: sitWorldX, y: sitWorldY },
      sitGrid: worldToGrid(sitWorldX, sitWorldY),
      sitDirection: parseFacing(tiledObjectProp(obj, "sitDirection")),
      spriteCenter: { x: obj.x!, y: obj.y! },
      ...(typeof deskSortDepth === "number" && { deskSortDepth }),
      ...(typeof chairSortDepth === "number" && { chairSortDepth }),
    })
  }
  for (const [chairId, chair] of chairs) {
    if (!chairId.startsWith("inner-")) continue
    const sit = agentSitWorld(chair)
    chair.sitWorld = sit
    chair.sitGrid = worldToGrid(sit.x, sit.y)
  }
  return chairs
}

export function chairDepthY(chair: ChairSpot) {
  return chair.spriteCenter.y
}

export function depthForSeatedAgent(chair: ChairSpot, footY = agentSitWorld(chair).y) {
  if (isInnerChair(chair)) {
    const agentDepth = 10 + footY + 0.05
    if (chair.deskSortDepth === undefined) return agentDepth
    const deskDepth = 10 + chair.deskSortDepth + 0.2
    if (chair.sitDirection === "up") return Math.max(agentDepth, deskDepth + 0.05)
    return Math.min(agentDepth, deskDepth - 0.05)
  }
  if (chair.deskSortDepth !== undefined) {
    const agentDepth = 10 + footY + 0.05
    if (isBossTopRow(chair)) return Math.max(agentDepth, bossTopRowChairDepth(chair) + 0.15)
    return agentDepth
  }
  const base = 10 + footY
  if (chair.sitDirection === "up") return base - 0.05
  return base + 0.05
}

export function depthForSeatedChair(chair: ChairSpot) {
  if (isInnerChair(chair)) return depthForInnerChair(chair)
  if (chair.chairSortDepth !== undefined) {
    if (isBossTopRow(chair)) return bossTopRowChairDepth(chair)
    return 10 + chair.chairSortDepth + 0.2
  }
  const base = 10 + chairDepthY(chair)
  if (chair.sitDirection === "up") return base + 0.05
  return base - 0.05
}

export function depthForInnerChairStanding(chair: ChairSpot) {
  return depthForInnerChair(chair)
}

export function depthForBossChairStanding(chair: ChairSpot) {
  if (chair.chairSortDepth !== undefined) {
    if (isBossTopRow(chair)) return bossTopRowChairDepth(chair)
    return 10 + chair.chairSortDepth + 0.2
  }
  return depthForStandingChair(chair)
}

export function depthForStandingChair(chair: ChairSpot) {
  return 4 + chairDepthY(chair) * 0.01
}

export function chairUsesBakedSprite(chair: ChairSpot) {
  if (chair.id.startsWith("boss-")) return false
  if (isInnerChair(chair)) return false
  return chair.propId === "chair_front"
}
