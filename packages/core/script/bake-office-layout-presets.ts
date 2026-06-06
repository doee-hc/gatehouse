#!/usr/bin/env bun
/**
 * Bake office layout presets for workstation counts 8–16.
 * Run once after changing cubicle placement logic or map assets:
 *   bun script/bake-office-layout-presets.ts
 */
import path from "node:path"
import { mkdirSync } from "node:fs"
import { officeLayoutAssetsDir } from "../src/portal/office-layout-gen/manual-workstation.ts"
import { exportPortalCollisionForBake } from "../src/portal/office-layout-gen/export-collision.ts"
import {
  OFFICE_LAYOUT_PRESET_MAX,
  OFFICE_LAYOUT_PRESET_MIN,
  officeLayoutPresetPath,
  officeLayoutPresetsDir,
  type OfficeLayoutPreset,
} from "../src/portal/office-layout-gen/preset-layouts.ts"
import { layoutSeed, layoutSeedInt } from "../src/portal/office-layout.ts"

const assetsDir = officeLayoutAssetsDir()
mkdirSync(officeLayoutPresetsDir(), { recursive: true })

for (let count = OFFICE_LAYOUT_PRESET_MIN; count <= OFFICE_LAYOUT_PRESET_MAX; count++) {
  const revision = `ws:${count}`
  const seed = layoutSeedInt(layoutSeed(revision))
  const t0 = performance.now()
  const { collision, placements } = await exportPortalCollisionForBake(assetsDir, {
    workstation_count: count,
    seed,
  })
  const preset: OfficeLayoutPreset = {
    schema_version: 1,
    workstation_count: count,
    seed,
    placements,
    collision,
  }
  const outPath = officeLayoutPresetPath(count)
  await Bun.write(outPath, JSON.stringify(preset))
  const ms = Math.round(performance.now() - t0)
  const seats = placements.reduce((sum, cluster) => sum + cluster.right_segments, 0)
  console.log(`[bake] ws-${count}.json — ${seats} seats, ${collision.chairs.length} chairs (${ms}ms)`)
}

console.log(`[bake] presets written to ${officeLayoutPresetsDir()}`)
