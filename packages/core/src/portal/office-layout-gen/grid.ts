export type Cell = {
  tags: Set<string>
  blocked: boolean
}

export class Grid {
  readonly width: number
  readonly height: number
  private cells: Cell[][]

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.cells = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => ({ tags: new Set<string>(), blocked: false })),
    )
  }

  inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  get(x: number, y: number) {
    return this.cells[y]![x]!
  }

  canPlaceRect(x: number, y: number, w: number, h: number, allowTags = new Set(["floor", "walkable"])) {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const nx = x + dx
        const ny = y + dy
        if (!this.inBounds(nx, ny)) return false
        const cell = this.get(nx, ny)
        if (cell.blocked) return false
        if (cell.tags.has("wall")) return false
        if (cell.tags.has("desk") || cell.tags.has("chair")) return false
        if (allowTags.size > 0 && ![...allowTags].some((tag) => cell.tags.has(tag)) && !cell.tags.has("floor")) return false
      }
    }
    return true
  }

  markBlockedRect(x: number, y: number, w: number, h: number, tags: Set<string>) {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const cell = this.get(x + dx, y + dy)
        cell.blocked = true
        for (const tag of tags) cell.tags.add(tag)
      }
    }
  }

  clone() {
    const copy = new Grid(this.width, this.height)
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const src = this.get(x, y)
        const dst = copy.get(x, y)
        dst.blocked = src.blocked
        dst.tags = new Set(src.tags)
      }
    }
    return copy
  }
}
