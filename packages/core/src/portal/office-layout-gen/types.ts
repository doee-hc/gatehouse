export const TILE = 32

export type PlacedObject = {
  object_id: string
  x: number
  y: number
  facing: string
}

export type WorkstationPlacement = {
  anchor_x: number
  anchor_y: number
  objects: PlacedObject[]
}

export type ClusterPlacement = {
  anchor: [number, number]
  right_segments: number
  objects: PlacedObject[]
}

export type SceneJson = {
  map_size?: [number, number]
  workstation_count?: number
  seed?: number
  boss_office?: string
  cubicle_meta?: string
  map_layers?: SceneLayer[]
  boss_exclusion?: { anchor: [number, number]; size: [number, number]; padding?: number }
  cluster?: {
    min_segments?: number
    max_segments?: number
    aisle_tiles?: number
    wall_clearance_tiles?: number
    layout_attempts?: number
  }
  walk_walls?: {
    rows?: number[]
    cols?: number[]
    segments?: { x0: number; y0: number; x1: number; y1: number }[]
  }
  cubicle_rows?: { anchor: [number, number]; right_segments?: number }[]
}

export type SceneLayer = {
  type?: string
  id?: string
  texture: string
  tile: [number, number]
  scope?: string
  backdrop?: boolean
}

export type ManualMeta = {
  raw: Record<string, unknown>
  assetsDir: string
  tile_size: number
  placement: Record<string, unknown>
  desk_segments: {
    left: DeskSegmentSpec
    right: DeskSegmentSpec & { variants?: DeskSegmentSpec[]; pick?: string; weights?: number[] }
  }
}

export type DeskSegmentSpec = {
  id: string
  texture: string
  width_tiles: number
  height_tiles: number
  anchor_pixel?: [number, number]
  width_pixels?: number
  height_pixels?: number
}

export type InnerChairSlot = {
  kind: "front" | "back"
  x: number
  y: number
  facing: string
  deskSortDepth: number
}

export type InnerDecorEntry = {
  decorKind: "desk" | "chair"
  texture: string
  x: number
  y: number
  deskSortDepth: number
  innerZone: true
  chairId?: string
  sortAnchor?: "top" | "bottom"
}

export type PortalCollisionExport = {
  width: number
  height: number
  blocked: boolean[][]
  chairs: InnerChairSlot[]
  decor: InnerDecorEntry[]
  warnings: string[]
}

export type DrawSprite = {
  image: PngImage
  x: number
  y: number
  depth: number
  label: string
}

export type PngImage = {
  width: number
  height: number
  pixels: Uint8Array
}
