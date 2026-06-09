import fs from "node:fs"
import path from "node:path"
import { readCorePackageRoot } from "../paths.ts"
import { gatehouseRoot } from "./config.ts"
import type { ChannelId } from "./types.ts"

const BRIDGE_DIR: Record<ChannelId, string> = {
  weixin: "weixin-bridge",
  feishu: "feishu-bridge",
  qq: "qq-bridge",
}

function findMonorepoRoot(startDir: string): string | undefined {
  let dir = path.resolve(startDir)
  for (let depth = 0; depth < 10; depth++) {
    const marker = path.join(dir, "packages", BRIDGE_DIR.weixin, "package.json")
    if (fs.existsSync(marker)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

function bridgeEntryFromMonorepo(root: string, channelId: ChannelId) {
  return path.join(root, "packages", BRIDGE_DIR[channelId], "src", "index.ts")
}

function bridgeEntryFromBundledCore(coreRoot: string, channelId: ChannelId) {
  return path.join(coreRoot, "bridges", BRIDGE_DIR[channelId], "src", "index.ts")
}

function bridgeEntryFromNodeModules(baseDir: string, channelId: ChannelId) {
  return path.join(baseDir, "node_modules", "@gatehouse", BRIDGE_DIR[channelId], "src", "index.ts")
}

function readCoreInstallRoot(searchDirs: string[]) {
  const seen = new Set<string>()
  for (const dir of searchDirs) {
    const fromMarker = readCorePackageRoot(dir)
    if (fromMarker && fs.existsSync(path.join(fromMarker, "package.json"))) return fromMarker

    const normalized = path.resolve(dir)
    if (seen.has(normalized)) continue
    seen.add(normalized)

    const corePkg = path.join(normalized, "node_modules", "@gatehouse", "core", "package.json")
    if (fs.existsSync(corePkg)) return path.dirname(corePkg)
  }
  return undefined
}

export function resolveBridgeEntry(channelId: ChannelId, searchDirs: string[]) {
  const envKey = `GATEHOUSE_BRIDGE_${channelId.toUpperCase()}_ENTRY`
  const override = process.env[envKey]?.trim()
  if (override) {
    const resolved = path.resolve(override)
    if (!fs.existsSync(resolved)) throw new Error(`${envKey} 指向的文件不存在: ${resolved}`)
    return resolved
  }

  const seen = new Set<string>()
  for (const dir of searchDirs) {
    const mono = findMonorepoRoot(dir)
    if (mono) {
      const entry = bridgeEntryFromMonorepo(mono, channelId)
      if (fs.existsSync(entry)) return entry
    }

    const normalized = path.resolve(dir)
    if (seen.has(normalized)) continue
    seen.add(normalized)

    const entry = bridgeEntryFromNodeModules(normalized, channelId)
    if (fs.existsSync(entry)) return entry
  }

  const coreRoot = readCoreInstallRoot(searchDirs)
  if (coreRoot) {
    const entry = bridgeEntryFromBundledCore(coreRoot, channelId)
    if (fs.existsSync(entry)) return entry
  }

  throw new Error(
    `找不到 ${channelId} bridge 入口。请安装 @gatehouse/core 并在项目中完成 scaffold，或在 Gatehouse monorepo 内运行，或设置 ${envKey}`,
  )
}
