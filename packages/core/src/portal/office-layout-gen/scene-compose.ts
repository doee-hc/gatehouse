import path from "node:path"
import type { DrawSprite, ManualMeta, SceneJson } from "./types.ts"
import { TILE } from "./types.ts"
import { initFloorGrid, placementGridOptions } from "./cubicle-clusters.ts"
import { applyManualWorkstation, loadManualMeta, rightVariantSpecs } from "./manual-workstation.ts"
import { capOfficeWorkstationCount } from "../office-layout.ts"
import { resolveCubiclePlacements } from "./cubicle-layout.ts"
import { PythonRandom } from "./python-random.ts"
import {
  entryTopLeftPx,
  layerDrawables,
  portalLayeredObject,
  splitMapLayers,
  spriteDepth,
} from "./scene-layers.ts"
import { blit, readPngFile, writePng } from "./png.ts"

export async function loadScene(scenePath: string) {
  return (await Bun.file(scenePath).json()) as SceneJson
}

async function placedToDraw(obj: import("./types.ts").PlacedObject, texturePath: string, label: string) {
  const image = await readPngFile(texturePath)
  return {
    image,
    x: obj.x,
    y: obj.y,
    depth: spriteDepth(obj.y, image.height),
    label,
  } satisfies DrawSprite
}

function objectTexture(meta: ManualMeta, objectId: string) {
  const left = meta.desk_segments.left
  if (objectId === left.id) return path.join(meta.assetsDir, left.texture)
  for (const spec of rightVariantSpecs(meta)) {
    if (spec.id === objectId) return path.join(meta.assetsDir, spec.texture)
  }
  const chair = meta.raw[objectId] as { texture?: string } | undefined
  if (chair?.texture) return path.join(meta.assetsDir, chair.texture)
  return undefined
}

export async function collectDrawables(
  scene: SceneJson,
  assetsDir: string,
  options: { skip_boss_furniture?: boolean; seed?: number } = {},
) {
  const seed = Number(options.seed ?? scene.seed ?? 0)
  const mapSize = scene.map_size ?? [37, 21]
  const draws: DrawSprite[] = []
  const warnings: string[] = []

  const bossPath = path.join(assetsDir, scene.boss_office ?? "boss_office.json")
  const bossLayout = (await Bun.file(bossPath).json()) as {
    anchor_tile: [number, number]
    layers: import("./types.ts").SceneLayer[]
  }

  const mapLayers = scene.map_layers ?? []
  const { back, front } = splitMapLayers(mapLayers)
  draws.push(...(await layerDrawables(back, assetsDir, null)))

  if (!options.skip_boss_furniture) {
    draws.push(...(await layerDrawables(bossLayout.layers, assetsDir, bossLayout.anchor_tile)))
  }

  const metaPath = path.join(assetsDir, scene.cubicle_meta ?? "meta.json")
  const meta = await loadManualMeta(metaPath)
  const seatCount = capOfficeWorkstationCount(Number(scene.workstation_count ?? 0))

  if (seatCount > 0) {
    const { placements, warnings: placementWarnings } = await resolveCubiclePlacements(assetsDir, seatCount, seed)
    warnings.push(...placementWarnings)
    for (const cluster of placements) {
      for (const obj of cluster.objects) {
        if (options.skip_boss_furniture && portalLayeredObject(obj.object_id)) continue
        const texturePath = objectTexture(meta, obj.object_id)
        if (!texturePath) continue
        draws.push(await placedToDraw(obj, texturePath, obj.object_id))
      }
    }
  } else if (scene.cubicle_rows?.length) {
    const gridOpts = placementGridOptions(scene)
    const clusterGrid = initFloorGrid(mapSize[0], mapSize[1], scene.boss_exclusion, {
      wall_clearance: gridOpts.wall_clearance,
      front_wall_top_row: gridOpts.front_wall_top_row,
      map_layers: scene.map_layers,
    })
    const rng = new PythonRandom(seed)
    for (const row of scene.cubicle_rows) {
      const [ax, ay] = row.anchor
      const rs = Number(row.right_segments ?? meta.placement.right_segments ?? 4)
      const wp = applyManualWorkstation(clusterGrid, meta, ax, ay, {
        right_segments: rs,
        include_back_chair: Boolean(meta.placement.include_back_chair ?? false),
        rng,
      })
      for (const obj of wp.objects) {
        if (options.skip_boss_furniture && portalLayeredObject(obj.object_id)) continue
        const texturePath = objectTexture(meta, obj.object_id)
        if (!texturePath) continue
        draws.push(await placedToDraw(obj, texturePath, obj.object_id))
      }
    }
  }

  draws.push(...(await layerDrawables(front, assetsDir, null)))
  draws.sort((a, b) => a.depth - b.depth)
  return { draws, warnings }
}

export async function renderPortalSceneBg(
  assetsDir: string,
  options: { workstation_count?: number; seed?: number; outputPath: string },
) {
  const scenePath = path.join(assetsDir, "full_office.json")
  const scene = await loadScene(scenePath)
  if (options.workstation_count !== undefined) {
    scene.workstation_count = options.workstation_count
    delete scene.cubicle_rows
  }
  if (options.seed !== undefined) scene.seed = options.seed

  const mapSize = scene.map_size ?? [37, 21]
  const { draws, warnings } = await collectDrawables(scene, assetsDir, {
    skip_boss_furniture: true,
    seed: options.seed,
  })
  const canvas = {
    width: mapSize[0] * TILE,
    height: mapSize[1] * TILE,
    pixels: new Uint8Array(mapSize[0] * TILE * mapSize[1] * TILE * 4),
  }
  const bg = [48, 48, 52, 255] as const
  for (let i = 0; i < canvas.width * canvas.height; i++) {
    canvas.pixels[i * 4] = bg[0]
    canvas.pixels[i * 4 + 1] = bg[1]
    canvas.pixels[i * 4 + 2] = bg[2]
    canvas.pixels[i * 4 + 3] = bg[3]
  }
  for (const draw of draws) {
    if (draw.x < 0 || draw.y < 0 || draw.x >= canvas.width || draw.y >= canvas.height) {
      warnings.push(`Skipped off-map sprite ${draw.label} at ${draw.x},${draw.y}`)
      continue
    }
    blit(canvas.pixels, canvas.width, draw.x, draw.y, draw.image)
  }
  await writePng(options.outputPath, canvas.width, canvas.height, canvas.pixels)
  return warnings
}
