import type { GridPoint } from "../pathfinding/astar.ts"

function walkable(point: GridPoint, blocked: boolean[][], mapWidth: number, mapHeight: number) {
  return (
    point.x >= 0 &&
    point.y >= 0 &&
    point.x < mapWidth &&
    point.y < mapHeight &&
    !blocked[point.y]?.[point.x]
  )
}

/** Walkable tiles around architect, stable order, one slot per retro agent. */
export function retroFollowSlots(
  architectGrid: GridPoint,
  count: number,
  blocked: boolean[][],
  mapWidth: number,
  mapHeight: number,
) {
  if (count <= 0) return [] as GridPoint[]
  const candidates: GridPoint[] = []
  for (let ring = 1; ring <= 6 && candidates.length < count * 2; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
        const point = { x: architectGrid.x + dx, y: architectGrid.y + dy }
        if (point.x === architectGrid.x && point.y === architectGrid.y) continue
        if (!walkable(point, blocked, mapWidth, mapHeight)) continue
        candidates.push(point)
      }
    }
  }
  candidates.sort((a, b) => a.x - b.x || a.y - b.y)
  return candidates.slice(0, count)
}

export function retroFollowGrid(
  spawnId: string,
  retroSpawnIds: string[],
  architectGrid: GridPoint,
  blocked: boolean[][],
  mapWidth: number,
  mapHeight: number,
) {
  const sorted = [...retroSpawnIds].sort()
  const index = sorted.indexOf(spawnId)
  if (index === -1) return undefined
  return retroFollowSlots(architectGrid, sorted.length, blocked, mapWidth, mapHeight)[index]
}
