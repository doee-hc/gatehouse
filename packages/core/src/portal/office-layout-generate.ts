import path from "node:path"
import { deflateSync } from "node:zlib"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { portalOfficeDir } from "../paths.ts"
import {
  bossAgentSitWorld,
  bossSitTileOffsetY,
  bossChairSortDepth,
  bossSeatWorld,
  BOSS_OFFICE_ANCHOR_TILE,
  BOSS_PROP_SIZE,
  chairAgentSitWorld,
  innerAgentSitWorld,
  chairSitOffsetForDirection,
  chairSitTileOffsetY,
  capOfficeWorkstationCount,
  layoutSeedInt,
  OUTER_BOSS_SEATS,
  WORKSTATION_SEATS,
  readOfficeLayoutManifest,
  type OfficeLayoutManifest,
  type OfficeLayoutSpec,
} from "./office-layout.ts"
import {
  exportPortalCollision,
  officeLayoutAssetsDir,
  renderPortalSceneBg,
} from "./office-layout-gen/index.ts"

const TILE = 32
const MAP_W = 37
const MAP_H = 21
const BLOCKED_TILE_INDEX = 2
const BOSS_LAYER_VERSION = 12
const INNER_DECOR_ID_START = 6000

type InnerDecorPlacement = {
  decorKind: "desk" | "chair"
  texture: string
  x: number
  y: number
  deskSortDepth: number
  innerZone: true
  chairId?: string
  sortAnchor?: "top" | "bottom"
}

type PortalMapObject = {
  id: number
  name: string
  type: string
  x: number
  y: number
  width: number
  height: number
  properties: { name: string; type: string; value: string | number }[]
}

function layoutGenRoot() {
  return path.dirname(officeLayoutAssetsDir())
}

function writeCollisionTilePng(filePath: string) {
  const tile = 32
  const width = tile * 2
  const height = tile
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const blocked = x >= tile
      const i = (y * width + x) * 4
      pixels[i] = blocked ? 255 : 0
      pixels[i + 1] = 0
      pixels[i + 2] = 0
      pixels[i + 3] = blocked ? 255 : 0
    }
  }
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = width * 4 + 1
  const raw = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0
    raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1)
  }
  const crc32 = (data: Uint8Array) => {
    let c = 0xffffffff
    for (let i = 0; i < data.length; i++) {
      c ^= data[i]!
      for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1
    }
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Uint8Array) => {
    const typeBytes = new TextEncoder().encode(type)
    const len = new Uint8Array(4)
    new DataView(len.buffer).setUint32(0, data.length)
    const body = new Uint8Array(4 + typeBytes.length + data.length + 4)
    body.set(len, 0)
    body.set(typeBytes, 4)
    body.set(data, 8)
    const crc = new Uint8Array(4)
    new DataView(crc.buffer).setUint32(0, crc32(body.subarray(4, 8 + data.length)))
    body.set(crc, 8 + data.length)
    return body
  }
  const parts = [
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]
  return Bun.write(filePath, Buffer.concat(parts.map((part) => Buffer.from(part))))
}

function readPngSize(filePath: string) {
  const buf = readFileSync(filePath)
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

function manualAssetSize(assetsDir: string, texture: string) {
  const filePath = path.join(assetsDir, texture)
  if (!existsSync(filePath)) return BOSS_PROP_SIZE[texture] ?? { w: 64, h: 64 }
  return readPngSize(filePath)
}

function buildCollisionFromWalkExport(payload: { width: number; height: number; blocked: boolean[][] }) {
  const data = new Array(MAP_W * MAP_H).fill(1)
  for (let y = 0; y < payload.height; y++) {
    for (let x = 0; x < payload.width; x++) {
      if (payload.blocked[y]?.[x]) data[y * MAP_W + x] = BLOCKED_TILE_INDEX
    }
  }
  return data
}

type InnerChairPlacement = {
  kind: "front" | "back"
  x: number
  y: number
  facing: string
  deskSortDepth: number
}

type PortalLayoutExport = {
  width: number
  height: number
  blocked: boolean[][]
  chairs: InnerChairPlacement[]
  decor: InnerDecorPlacement[]
  warnings: string[]
}

async function exportPortalLayout(assetsDir: string, count: number, seed: number) {
  const payload = await exportPortalCollision(assetsDir, { workstation_count: count, seed })
  return {
    width: payload.width ?? MAP_W,
    height: payload.height ?? MAP_H,
    blocked: payload.blocked ?? [],
    chairs: (payload.chairs ?? []).flatMap((entry) => {
      if (typeof entry.x !== "number" || typeof entry.y !== "number") return []
      if (typeof entry.deskSortDepth !== "number") return []
      return [entry as InnerChairPlacement]
    }),
    decor: (payload.decor ?? []).flatMap((entry) => {
      if (typeof entry.x !== "number" || typeof entry.y !== "number") return []
      if (typeof entry.texture !== "string" || typeof entry.deskSortDepth !== "number") return []
      if (entry.decorKind !== "desk" && entry.decorKind !== "chair") return []
      return [entry as InnerDecorPlacement]
    }),
    warnings: payload.warnings ?? [],
  } satisfies PortalLayoutExport
}

function portalObjectProp(obj: PortalMapObject, name: string) {
  return obj.properties.find((entry) => entry.name === name)?.value
}

async function buildBossDecorObjects(assetsDir: string) {
  const bossLayout = (await Bun.file(path.join(assetsDir, "boss_office.json")).json()) as {
    layers: { type: string; id: string; texture: string; tile: [number, number] }[]
  }
  const chairAgentByLayerId: Record<string, string> = {
    tl_chair: "lead",
    tr_chair: "architect",
    dl_chair: "curator",
    dr_chair: "arbiter",
  }
  const objects: PortalMapObject[] = []
  let nextId = 5000
  for (const entry of bossLayout.layers) {
    const size = manualAssetSize(assetsDir, entry.texture)
    const x = (BOSS_OFFICE_ANCHOR_TILE.x + entry.tile[0]) * TILE
    const y = (BOSS_OFFICE_ANCHOR_TILE.y + entry.tile[1]) * TILE
    const decorKind = entry.type === "chair" ? "chair" : entry.type === "desk" ? "desk" : "sprite"
    const properties: { name: string; type: string; value: string | number }[] = [
      { name: "texture", type: "string", value: entry.texture },
      { name: "decorKind", type: "string", value: decorKind },
    ]
    const agentId = chairAgentByLayerId[entry.id]
    if (agentId) properties.push({ name: "chairId", type: "string", value: `boss-${agentId}` })
    properties.push({ name: "depthSortY", type: "float", value: y + size.h })
    objects.push({
      id: nextId++,
      name: entry.id,
      type: "decor",
      x,
      y,
      width: size.w,
      height: size.h,
      properties,
    })
  }
  return objects
}

function buildInnerDecorObjects(assetsDir: string, layoutExport: PortalLayoutExport) {
  const objects: PortalMapObject[] = []
  let nextId = INNER_DECOR_ID_START
  for (const entry of layoutExport.decor) {
    const size = manualAssetSize(assetsDir, entry.texture)
    const properties: { name: string; type: string; value: string | number }[] = [
      { name: "texture", type: "string", value: entry.texture },
      { name: "decorKind", type: "string", value: entry.decorKind },
      { name: "deskSortDepth", type: "float", value: entry.deskSortDepth },
      { name: "innerZone", type: "string", value: "true" },
    ]
    if (entry.chairId) properties.push({ name: "chairId", type: "string", value: entry.chairId })
    if (entry.sortAnchor) properties.push({ name: "sortAnchor", type: "string", value: entry.sortAnchor })
    properties.push({ name: "depthSortY", type: "float", value: entry.deskSortDepth })
    objects.push({
      id: nextId++,
      name: entry.chairId ?? `inner-${entry.decorKind}-${entry.x}-${entry.y}`,
      type: "decor",
      x: entry.x,
      y: entry.y,
      width: size.w,
      height: size.h,
      properties: properties satisfies PortalMapObject["properties"],
    })
  }
  return objects
}

function buildPortalMap(
  spec: OfficeLayoutSpec,
  warnings: string[],
  assetsDir: string,
  layoutExport: PortalLayoutExport,
  decorObjects?: PortalMapObject[],
) {
  const furnitureObjects: PortalMapObject[] = []
  const anchorObjects: PortalMapObject[] = []
  const spawnObjects: PortalMapObject[] = []
  let nextId = 1

  for (const seat of OUTER_BOSS_SEATS) {
    const world = bossSeatWorld(seat.chairTile)
    const sit = chairSitOffsetForDirection(seat.sitDirection)
    const sitWorld = bossAgentSitWorld(seat)
    const deskSize = manualAssetSize(assetsDir, seat.deskTexture)
    const deskWorld = bossSeatWorld(seat.deskTile)
    const deskSortDepth = deskWorld.y + deskSize.h
    const chairSortDepth = bossChairSortDepth(seat)
    const chairId = `boss-${seat.agentId}`
    furnitureObjects.push({
      id: nextId++,
      name: seat.propId,
      type: "furniture",
      x: world.x,
      y: world.y,
      width: 32,
      height: 64,
      properties: [
        { name: "propId", type: "string", value: seat.propId },
        { name: "chairId", type: "string", value: chairId },
        { name: "chairNodeX", type: "float", value: world.x },
        { name: "chairNodeY", type: "float", value: world.y },
        { name: "sitX", type: "float", value: sit.sitX },
        { name: "sitY", type: "float", value: sit.sitY + bossSitTileOffsetY(seat) * TILE },
        { name: "sitDirection", type: "string", value: seat.sitDirection },
        { name: "deskSortDepth", type: "float", value: deskSortDepth },
        { name: "chairSortDepth", type: "float", value: chairSortDepth },
      ],
    })
    anchorObjects.push({
      id: nextId++,
      name: "desk-anchor",
      type: "desk_anchor",
      x: sitWorld.x,
      y: sitWorld.y,
      width: 1,
      height: 1,
      properties: [
        { name: "zoneId", type: "string", value: "office" },
        { name: "agentId", type: "string", value: seat.agentId },
        { name: "chairId", type: "string", value: chairId },
      ],
    })
    spawnObjects.push({
      id: nextId++,
      name: seat.agentId,
      type: "agent",
      x: sitWorld.x - 16,
      y: sitWorld.y - 28,
      width: 32,
      height: 32,
      properties: [{ name: "agentId", type: "string", value: seat.agentId }],
    })
  }

  const seatTarget = spec.workstation_count
  const agentCapacity = seatTarget * WORKSTATION_SEATS
  const innerChairs = layoutExport.chairs
  const placedSeats = innerChairs.filter((chair) => chair.kind === "front").length
  if (placedSeats < seatTarget) {
    warnings.push(`Placed ${placedSeats}/${seatTarget} inner workstation seats`)
  }

  for (let agentSlot = 0; agentSlot < agentCapacity; agentSlot++) {
    const chair = innerChairs[agentSlot]
    if (!chair) continue
    const sitDirection = chair.facing === "up" || chair.facing === "down" ? chair.facing : chair.kind === "back" ? "down" : "up"
    const isBack = chair.kind === "back"
    const chairId = `inner-${agentSlot}`
    const sitWorld = innerAgentSitWorld(chair.x, chair.y, sitDirection)
    const sitWorldX = sitWorld.x
    const sitWorldY = sitWorld.y
    furnitureObjects.push({
      id: nextId++,
      name: isBack ? "chair_back" : "chair_front",
      type: "furniture",
      x: chair.x,
      y: chair.y,
      width: 32,
      height: 64,
      properties: [
        { name: "propId", type: "string", value: isBack ? "chair_back" : "chair_front" },
        { name: "chairId", type: "string", value: chairId },
        { name: "chairNodeX", type: "float", value: chair.x },
        { name: "chairNodeY", type: "float", value: chair.y },
        { name: "sitX", type: "float", value: sitWorldX - chair.x },
        { name: "sitY", type: "float", value: sitWorldY - chair.y },
        { name: "sitDirection", type: "string", value: sitDirection },
        { name: "deskSortDepth", type: "float", value: chair.deskSortDepth },
      ],
    })
    anchorObjects.push({
      id: nextId++,
      name: "desk-anchor",
      type: "desk_anchor",
      x: sitWorldX,
      y: sitWorldY,
      width: 1,
      height: 1,
      properties: [
        { name: "zoneId", type: "string", value: "office" },
        { name: "chairId", type: "string", value: chairId },
        { name: "slot", type: "int", value: agentSlot },
      ],
    })
  }

  return {
    compressionlevel: -1,
    height: MAP_H,
    width: MAP_W,
    tilewidth: TILE,
    tileheight: TILE,
    orientation: "orthogonal",
    renderorder: "right-down",
    infinite: false,
    tilesets: [
      {
        firstgid: 1,
        name: "collision-tiles",
        tilewidth: TILE,
        tileheight: TILE,
        tilecount: 2,
        columns: 2,
        image: "collision-tile.png",
        imagewidth: TILE * 2,
        imageheight: TILE,
      },
    ],
    layers: [
      {
        id: 1,
        name: "collision",
        type: "tilelayer",
        width: MAP_W,
        height: MAP_H,
        visible: false,
        opacity: 1,
        x: 0,
        y: 0,
        data: buildCollisionFromWalkExport(layoutExport),
      },
      {
        id: 2,
        name: "anchors",
        type: "objectgroup",
        visible: false,
        opacity: 1,
        x: 0,
        y: 0,
        objects: anchorObjects,
      },
      {
        id: 3,
        name: "furniture",
        type: "objectgroup",
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        objects: furnitureObjects,
      },
      {
        id: 4,
        name: "spawns",
        type: "objectgroup",
        visible: false,
        opacity: 1,
        x: 0,
        y: 0,
        objects: spawnObjects,
      },
      ...(decorObjects && decorObjects.length > 0
        ? [
            {
              id: 5,
              name: "decor",
              type: "objectgroup",
              visible: true,
              opacity: 1,
              x: 0,
              y: 0,
              objects: decorObjects,
            },
          ]
        : []),
    ],
  }
}

export async function generateOfficeLayout(projectDirectory: string, spec: OfficeLayoutSpec) {
  const assetsDir = officeLayoutAssetsDir()
  if (!existsSync(path.join(assetsDir, "full_office.json"))) {
    throw new Error(`office-layout-gen assets not found at ${assetsDir}`)
  }

  const genRoot = layoutGenRoot()
  const officeDir = portalOfficeDir(projectDirectory)
  mkdirSync(officeDir, { recursive: true })

  const seed = layoutSeedInt(spec.seed)
  const count = capOfficeWorkstationCount(spec.workstation_count)
  const bundledMeta = path.join(genRoot, "output", "boss_office", "office_full.meta.json")
  const meta = (await Bun.file(bundledMeta).json().catch(() => ({}))) as {
    warnings?: string[]
  }

  const sceneBgPath = path.join(officeDir, "scene-bg.png")
  await renderPortalSceneBg(assetsDir, {
    workstation_count: count,
    seed,
    outputPath: sceneBgPath,
  })

  const layoutExport = await exportPortalLayout(assetsDir, count, seed)
  const decorObjects = [
    ...(await buildBossDecorObjects(assetsDir)),
    ...buildInnerDecorObjects(assetsDir, layoutExport),
  ]
  const manualAssets = assetsDir
  const objectsDir = path.join(officeDir, "assets", "objects")
  mkdirSync(objectsDir, { recursive: true })
  const decorFiles = [
    ...new Set(
      decorObjects.flatMap((obj) => {
        const texture = portalObjectProp(obj, "texture")
        return typeof texture === "string" ? [texture] : []
      }),
    ),
  ]
  for (const file of decorFiles) {
    const source = path.join(manualAssets, file)
    if (existsSync(source)) await Bun.write(path.join(objectsDir, file), Bun.file(source))
  }

  const warnings = [...(meta.warnings ?? []), ...layoutExport.warnings]
  const map = buildPortalMap(spec, warnings, assetsDir, layoutExport, decorObjects)
  mkdirSync(officeDir, { recursive: true })

  await writeCollisionTilePng(path.join(officeDir, "collision-tile.png"))

  const manifest: OfficeLayoutManifest = {
    version: 1,
    revision: spec.revision,
    mapKey: "office-layout",
    mode: "scene-bg",
    sceneBgKey: "office-scene-bg",
    tileSize: TILE,
    sceneBackgroundColor: "#b5c4ad",
    workstation_count: spec.workstation_count,
    bossLayered: true,
    bossLayerVersion: BOSS_LAYER_VERSION,
    decorObjects: decorFiles.map((file) => ({ texture: file, file })),
    ...(warnings.length > 0 && { warnings }),
  }

  await Bun.write(path.join(officeDir, "map.json"), JSON.stringify(map, null, 2))
  await Bun.write(path.join(officeDir, "manifest.json"), JSON.stringify(manifest, null, 2))

  return { officeDir, manifest, warnings }
}

export async function officeLayoutAssetsReady(projectDirectory: string) {
  const officeDir = portalOfficeDir(projectDirectory)
  if (!existsSync(path.join(officeDir, "scene-bg.png"))) return false
  if (!existsSync(path.join(officeDir, "map.json"))) return false
  const manifest = await readOfficeLayoutManifest(projectDirectory)
  if (manifest?.version !== 1) return false
  if (!manifest.bossLayered || (manifest.bossLayerVersion ?? 1) < BOSS_LAYER_VERSION) return false
  return true
}

/** Generate portal office assets only when map/scene/manifest are missing (cheap on repeat dev starts). */
export async function ensureOfficeLayoutIfMissing(projectDirectory: string) {
  if (await officeLayoutAssetsReady(projectDirectory)) return undefined
  return syncOfficeLayout(projectDirectory)
}

export async function syncOfficeLayout(projectDirectory: string) {
  const { computeOfficeLayoutSpec, writeOfficeLayoutSpec, readOfficeLayoutManifest } = await import("./office-layout.ts")
  const spec = await computeOfficeLayoutSpec(projectDirectory)
  await writeOfficeLayoutSpec(projectDirectory, spec)

  const officeDir = portalOfficeDir(projectDirectory)
  const existing = await readOfficeLayoutManifest(projectDirectory)
  const sceneReady = await Bun.file(path.join(officeDir, "scene-bg.png")).exists()
  const mapReady = await Bun.file(path.join(officeDir, "map.json")).exists()
  if (existing?.revision === spec.revision && sceneReady && mapReady && existing?.bossLayered && (existing.bossLayerVersion ?? 1) >= BOSS_LAYER_VERSION) {
    return { status: "cached" as const, spec, manifest: existing }
  }

  const generated = await generateOfficeLayout(projectDirectory, spec)
  return { status: "generated" as const, spec, ...generated }
}
