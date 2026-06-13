import { existsSync, readFileSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export const GATEHOUSE_NPM_PACKAGE = "@gatehouse/core"
export const GATEHOUSE_SERVER_PLUGIN = GATEHOUSE_NPM_PACKAGE
/** npm spec written to tui.json — OpenCode resolves exports["./tui"]; not "@gatehouse/core/tui". */
export const GATEHOUSE_TUI_CONFIG_PLUGIN = GATEHOUSE_NPM_PACKAGE

export function gatehousePackageRoot(fromDir = import.meta.dir) {
  let dir = path.resolve(fromDir)
  let fallback = path.resolve(fromDir, "..")
  while (true) {
    const candidate = path.join(dir, "package.json")
    if (existsSync(candidate)) {
      fallback = dir
      try {
        const name = JSON.parse(readFileSync(candidate, "utf8") as string).name
        if (name === GATEHOUSE_NPM_PACKAGE) return dir
      } catch {
        return dir
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) return fallback
    dir = parent
  }
}

export function gatehousePortalUiDir(packageRoot: string) {
  const fromEnv = process.env.GATEHOUSE_PORTAL_UI_DIR?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  return path.join(packageRoot, "dist", "portal")
}

export function gatehousePortalSourceDir(packageRoot: string) {
  const fromEnv = process.env.GATEHOUSE_PORTAL_SOURCE_DIR?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  return path.resolve(packageRoot, "../portal")
}

export function gatehousePortalUiReady(packageRoot: string) {
  if (process.env.GATEHOUSE_PORTAL_VITE_DEV === "1") {
    return existsSync(path.join(gatehousePortalSourceDir(packageRoot), "index.html"))
  }
  return existsSync(path.join(gatehousePortalUiDir(packageRoot), "index.html"))
}

export function useLocalPluginEntry() {
  return process.env.GATEHOUSE_DEV === "1" || process.env.GATEHOUSE_LOCAL_PLUGIN === "1"
}

/** npm plugin id for installs; file:// paths for monorepo dev/scaffold. */
export function resolveGatehouseServerPluginEntry(packageRoot: string) {
  if (useLocalPluginEntry()) return pathToFileURL(packageRoot).href
  return GATEHOUSE_SERVER_PLUGIN
}

export function resolveGatehouseTuiPluginEntry(packageRoot: string) {
  if (useLocalPluginEntry()) {
    const source = path.join(packageRoot, "src", "tui", "index.ts")
    if (existsSync(source)) return pathToFileURL(source).href
  }
  return GATEHOUSE_TUI_CONFIG_PLUGIN
}

export function gatehouseCorePluginSpec(pluginRoot: string) {
  return resolveGatehouseServerPluginEntry(pluginRoot)
}

export function gatehouseTuiPluginSpec(pluginRoot: string) {
  return resolveGatehouseTuiPluginEntry(pluginRoot)
}

function isGatehouseArchiveFile(resolved: string) {
  return resolved.endsWith(".tgz") || resolved.endsWith(".tar.gz")
}

function gatehouseInstallRoot(version: string) {
  return path.join(homedir(), ".cache", "gatehouse", `core-${version}`)
}

/** OpenCode plugin spec for a materialized install directory. */
export function gatehouseDirectoryPluginSpec(installDir: string) {
  return pathToFileURL(path.resolve(installDir)).href
}

/** TUI plugin spec for a materialized archive install (file:// src/tui/index.ts). */
export function gatehouseArchiveTuiPluginSpec(serverSpec: string) {
  if (!serverSpec.startsWith("file:")) return GATEHOUSE_TUI_CONFIG_PLUGIN
  const installDir = fileURLToPath(serverSpec)
  const source = path.join(installDir, "src", "tui", "index.ts")
  if (existsSync(source)) return pathToFileURL(source).href
  return serverSpec
}

/** OpenCode npm resolver spec for a local .tgz archive (not a bare filesystem path). */
export function gatehouseArchivePluginSpec(archivePath: string) {
  const resolved = path.resolve(archivePath)
  if (!existsSync(resolved)) throw new Error(`Gatehouse archive not found: ${resolved}`)
  if (isGatehouseArchiveFile(resolved)) return `file:${resolved}`
  return gatehouseDirectoryPluginSpec(resolved)
}

/**
 * Extract a .tgz locally, install production deps with Bun, and return a file:// plugin directory.
 * Avoids `opencode plug file:...tgz`, which blocks on npm registry downloads with no progress UI.
 */
export async function materializeGatehouseArchive(archivePath: string) {
  const resolved = path.resolve(archivePath)
  if (!existsSync(resolved)) throw new Error(`Gatehouse archive not found: ${resolved}`)

  if (!isGatehouseArchiveFile(resolved)) {
    const pkg = path.join(resolved, "package.json")
    if (!existsSync(pkg)) throw new Error(`Gatehouse directory is missing package.json: ${resolved}`)
    return gatehouseDirectoryPluginSpec(resolved)
  }

  const staging = path.join(homedir(), ".cache", "gatehouse", "_staging")
  rmSync(staging, { recursive: true, force: true })
  await Bun.$`mkdir -p ${staging}`.quiet()
  await Bun.$`tar -xzf ${resolved} -C ${staging} --strip-components=1`.quiet()

  const pkgJson = JSON.parse(await Bun.file(path.join(staging, "package.json")).text()) as { version?: string }
  const version = typeof pkgJson.version === "string" && pkgJson.version.trim() ? pkgJson.version.trim() : "0.0.0"
  const installDir = gatehouseInstallRoot(version)
  rmSync(installDir, { recursive: true, force: true })
  await Bun.$`mkdir -p ${installDir}`.quiet()
  await Bun.$`cp -a ${staging}/. ${installDir}/`.quiet()

  console.log(`[gatehouse] installing production dependencies in ${installDir} …`)
  const proc = Bun.spawn(["bun", "install", "--production"], {
    cwd: installDir,
    stdout: "inherit",
    stderr: "inherit",
  })
  if ((await proc.exited) !== 0) throw new Error(`bun install failed in ${installDir}`)

  return gatehouseDirectoryPluginSpec(installDir)
}
