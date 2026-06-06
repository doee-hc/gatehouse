export type GridPoint = { x: number; y: number }

type Node = GridPoint & { g: number; h: number; f: number; parent?: Node }

function key(p: GridPoint) {
  return `${p.x},${p.y}`
}

function heuristic(a: GridPoint, b: GridPoint) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

function neighbors(p: GridPoint, width: number, height: number) {
  const next: GridPoint[] = []
  if (p.x > 0) next.push({ x: p.x - 1, y: p.y })
  if (p.x < width - 1) next.push({ x: p.x + 1, y: p.y })
  if (p.y > 0) next.push({ x: p.x, y: p.y - 1 })
  if (p.y < height - 1) next.push({ x: p.x, y: p.y + 1 })
  return next
}

export function findPath(blocked: boolean[][], start: GridPoint, end: GridPoint) {
  if (blocked[end.y]?.[end.x]) return []
  if (start.x === end.x && start.y === end.y) return [start]

  const height = blocked.length
  const width = blocked[0]?.length ?? 0
  const open = new Map<string, Node>()
  const closed = new Set<string>()
  const startNode: Node = { ...start, g: 0, h: heuristic(start, end), f: heuristic(start, end) }
  open.set(key(start), startNode)

  while (open.size > 0) {
    const current = [...open.values()].reduce((best, node) => (node.f < best.f ? node : best))
    open.delete(key(current))
    closed.add(key(current))

    if (current.x === end.x && current.y === end.y) {
      const path: GridPoint[] = []
      let node: Node | undefined = current
      while (node) {
        path.unshift({ x: node.x, y: node.y })
        node = node.parent
      }
      return path
    }

    for (const next of neighbors(current, width, height)) {
      if (blocked[next.y]?.[next.x]) continue
      const id = key(next)
      if (closed.has(id)) continue
      const g = current.g + 1
      const existing = open.get(id)
      if (existing && g >= existing.g) continue
      const node: Node = {
        x: next.x,
        y: next.y,
        g,
        h: heuristic(next, end),
        f: g + heuristic(next, end),
        parent: current,
      }
      open.set(id, node)
    }
  }

  return []
}
