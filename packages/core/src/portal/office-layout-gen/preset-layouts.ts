import path from "node:path"
import { existsSync } from "node:fs"
import { MAX_OFFICE_WORKSTATION_COUNT } from "../office-layout.ts"
import type { ClusterPlacement, PortalCollisionExport } from "./types.ts"
import { officeLayoutAssetsDir } from "./manual-workstation.ts"

export const OFFICE_LAYOUT_PRESET_MIN = 8
export const OFFICE_LAYOUT_PRESET_MAX = MAX_OFFICE_WORKSTATION_COUNT

export type OfficeLayoutPreset = {
  schema_version: 1
  workstation_count: number
  seed: number
  placements: ClusterPlacement[]
  collision: PortalCollisionExport
}

const presetCache = new Map<number, OfficeLayoutPreset>()

export function officeLayoutPresetsDir() {
  return path.join(officeLayoutAssetsDir(), "presets")
}

export function officeLayoutPresetPath(workstationCount: number) {
  return path.join(officeLayoutPresetsDir(), `ws-${workstationCount}.json`)
}

export function officeLayoutPresetAvailable(workstationCount: number) {
  return (
    workstationCount >= OFFICE_LAYOUT_PRESET_MIN &&
    workstationCount <= OFFICE_LAYOUT_PRESET_MAX &&
    existsSync(officeLayoutPresetPath(workstationCount))
  )
}

export async function readOfficeLayoutPreset(workstationCount: number) {
  if (!officeLayoutPresetAvailable(workstationCount)) return undefined
  const cached = presetCache.get(workstationCount)
  if (cached) return cached
  const preset = (await Bun.file(officeLayoutPresetPath(workstationCount)).json()) as OfficeLayoutPreset
  if (preset.schema_version !== 1 || preset.workstation_count !== workstationCount) return undefined
  presetCache.set(workstationCount, preset)
  return preset
}

export function clearOfficeLayoutPresetCacheForTests() {
  presetCache.clear()
}
