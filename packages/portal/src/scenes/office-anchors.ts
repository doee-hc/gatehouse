import type { AgentStatus } from "../office/dom-labels.ts"
import { officeTileSize } from "../office/office-tile-size.ts"
import type { GridPoint } from "../pathfinding/astar.ts"
import { tiledObjectProp } from "./tiled-props.ts"

export type AnchorZone = "office"

export type DeskAnchor = {
  grid: GridPoint
  zoneId: AnchorZone
  agentId?: string
  chairId?: string
}

const ANCHOR_ZONES = new Set<AnchorZone>(["office"])

export function readDeskAnchors(map: Phaser.Tilemaps.Tilemap) {
  const tile = officeTileSize
  const anchors: DeskAnchor[] = []

  const dedicated = map.getObjectLayer("anchors")
  dedicated?.objects.forEach((obj) => {
    if (obj.type !== "desk_anchor") return
    const zoneRaw = tiledObjectProp(obj, "zoneId")
    if (typeof zoneRaw !== "string" || !ANCHOR_ZONES.has(zoneRaw as AnchorZone)) return
    const agentRaw = tiledObjectProp(obj, "agentId")
    const chairRaw = tiledObjectProp(obj, "chairId")
    anchors.push({
      grid: { x: Math.floor(obj.x! / tile), y: Math.floor(obj.y! / tile) },
      zoneId: zoneRaw as AnchorZone,
      agentId: typeof agentRaw === "string" ? agentRaw : undefined,
      chairId: typeof chairRaw === "string" ? chairRaw : undefined,
    })
  })

  const furniture = map.getObjectLayer("furniture")
  furniture?.objects.forEach((obj) => {
    if (obj.type !== "anchor") return
    const role = tiledObjectProp(obj, "anchorRole")
    if (role !== "workspace") return
    const chairId = tiledObjectProp(obj, "chairId")
    anchors.push({
      grid: { x: Math.floor(obj.x! / tile), y: Math.floor(obj.y! / tile) },
      zoneId: "office",
      chairId: typeof chairId === "string" ? chairId : undefined,
    })
  })

  return anchors
}

export function targetZoneForStatus(status: AgentStatus): AnchorZone | undefined {
  if (status === "idle") return undefined
  return "office"
}

export function agentShouldSitAtDesk(status: AgentStatus) {
  return status !== "idle"
}

export function anchorGridKey(grid: GridPoint) {
  return `${grid.x},${grid.y}`
}

export function occupiedAnchorKeys(agents: Iterable<{ agentId: string; grid: GridPoint }>, skipAgentId?: string) {
  const keys = new Set<string>()
  for (const agent of agents) {
    if (agent.agentId === skipAgentId) continue
    keys.add(anchorGridKey(agent.grid))
  }
  return keys
}

export function pickAnchorForAgent(
  agentId: string,
  from: GridPoint,
  status: AgentStatus,
  anchors: DeskAnchor[],
  occupied: Set<string>,
) {
  const zoneId = targetZoneForStatus(status)
  if (!zoneId) return undefined
  const inZone = anchors.filter((anchor) => anchor.zoneId === zoneId)
  if (inZone.length === 0) return undefined

  const dedicated = inZone.find(
    (anchor) => anchor.agentId === agentId && !occupied.has(anchorGridKey(anchor.grid)),
  )
  if (dedicated) return dedicated.grid

  const free = inZone.filter((anchor) => !occupied.has(anchorGridKey(anchor.grid)))
  if (free.length === 0) return undefined

  return free.sort(
    (a, b) =>
      Math.abs(a.grid.x - from.x) +
      Math.abs(a.grid.y - from.y) -
      (Math.abs(b.grid.x - from.x) + Math.abs(b.grid.y - from.y)),
  )[0]!.grid
}

export function workspaceAnchorAt(agentId: string, grid: GridPoint, anchors: DeskAnchor[]) {
  return anchors.find(
    (anchor) =>
      anchor.zoneId === "office" &&
      anchor.grid.x === grid.x &&
      anchor.grid.y === grid.y &&
      (anchor.agentId === undefined || anchor.agentId === agentId),
  )
}

export function isAtWorkspaceAnchor(agentId: string, grid: GridPoint, anchors: DeskAnchor[]) {
  return workspaceAnchorAt(agentId, grid, anchors) !== undefined
}

export function pickWanderTarget(
  agentId: string,
  from: GridPoint,
  blocked: boolean[][],
  mapWidth: number,
  mapHeight: number,
  tick: number,
) {
  const walkable: GridPoint[] = []
  for (let y = 1; y < mapHeight - 1; y++) {
    for (let x = 1; x < mapWidth - 1; x++) {
      if (!blocked[y]?.[x]) walkable.push({ x, y })
    }
  }
  if (walkable.length === 0) return undefined

  let hash = tick
  for (const char of agentId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  for (let attempt = 0; attempt < 8; attempt++) {
    const target = walkable[(hash + attempt * 7919) % walkable.length]!
    if (Math.abs(target.x - from.x) + Math.abs(target.y - from.y) >= 3) return target
  }
  return walkable[hash % walkable.length]
}
