import { officeTileSize } from "../office/office-tile-size.ts"
import type { GridPoint } from "./astar.ts"

export type WorldPoint = { x: number; y: number }

export function gridCenter(grid: GridPoint): WorldPoint {
  return {
    x: grid.x * officeTileSize + officeTileSize / 2,
    y: grid.y * officeTileSize + officeTileSize / 2,
  }
}

export function worldToGrid(x: number, y: number): GridPoint {
  return {
    x: Math.floor(x / officeTileSize),
    y: Math.floor(y / officeTileSize),
  }
}

/** Drop collinear grid nodes so movement follows straight segments between corners. */
export function simplifyGridPath(path: GridPoint[]) {
  if (path.length <= 2) return path
  const out: GridPoint[] = [path[0]!]
  for (let i = 1; i < path.length - 1; i++) {
    const prev = out[out.length - 1]!
    const curr = path[i]!
    const next = path[i + 1]!
    const dx1 = curr.x - prev.x
    const dy1 = curr.y - prev.y
    const dx2 = next.x - curr.x
    const dy2 = next.y - curr.y
    if (dx1 === dx2 && dy1 === dy2) continue
    out.push(curr)
  }
  out.push(path[path.length - 1]!)
  return out
}

export function gridPathToWorldWaypoints(path: GridPoint[], end?: WorldPoint) {
  const simplified = simplifyGridPath(path)
  if (simplified.length <= 1) return [] as WorldPoint[]
  const points = simplified.slice(1).map(gridCenter)
  if (end && points.length > 0) points[points.length - 1] = end
  return points
}
