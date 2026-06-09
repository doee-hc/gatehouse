import fs from "node:fs"
import path from "node:path"

/** Marker file under `.gatehouse/` pointing at the installed `@gatehouse/core` package root. */
export const CORE_PACKAGE_MARKER = "core.path"

const LEGACY_CORE_PACKAGE_MARKER = "gatehouse-core.path"

function gatehouseRoot(projectDir: string) {
  return path.join(projectDir, ".gatehouse")
}

export function corePackageMarkerPath(projectDir: string) {
  return path.join(gatehouseRoot(projectDir), CORE_PACKAGE_MARKER)
}

export function readCorePackageRoot(projectDir: string): string | undefined {
  const root = gatehouseRoot(projectDir)
  for (const name of [CORE_PACKAGE_MARKER, LEGACY_CORE_PACKAGE_MARKER]) {
    const marker = path.join(root, name)
    if (!fs.existsSync(marker)) continue
    const value = fs.readFileSync(marker, "utf-8").trim()
    if (value) return value
  }
  return undefined
}

export function resolveChannelStateDir(projectDir: string, channelId: string) {
  return path.join(projectDir, ".gatehouse", "channels", channelId)
}
