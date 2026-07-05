import fs from "node:fs"
import path from "node:path"

/** Marker file under `.gatehouse/` pointing at the installed `@gatehouse/core` package root. */
export const CORE_PACKAGE_MARKER = "core.path"

function gatehouseRoot(projectDir: string) {
  return path.join(projectDir, ".gatehouse")
}

export function corePackageMarkerPath(projectDir: string) {
  return path.join(gatehouseRoot(projectDir), CORE_PACKAGE_MARKER)
}

export function readCorePackageRoot(projectDir: string): string | undefined {
  const marker = corePackageMarkerPath(projectDir)
  if (!fs.existsSync(marker)) return undefined
  const value = fs.readFileSync(marker, "utf-8").trim()
  return value || undefined
}

export function resolveChannelStateDir(projectDir: string, channelId: string) {
  return path.join(projectDir, ".gatehouse", "channels", channelId)
}
