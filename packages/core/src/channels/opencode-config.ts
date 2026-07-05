import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  projectOpencodeConfigPath,
  readProjectOpencodeConfigText,
} from "./project-opencode-config.ts"

export const CHANNELS_PLUGIN_PACKAGE = "@gatehouse/core/channels/plugin"

export { projectOpencodeConfigPath } from "./project-opencode-config.ts"

function parseJsonc(text: string) {
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  return JSON.parse(withoutComments) as Record<string, unknown>
}

export function gatehouseCorePackageRoot(fromDir: string) {
  let dir = path.resolve(fromDir)
  while (true) {
    const candidate = path.join(dir, "package.json")
    if (existsSync(candidate)) {
      try {
        const name = JSON.parse(readFileSync(candidate, "utf8") as string).name
        if (name === "@gatehouse/core") return dir
      } catch {
        return dir
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error("Cannot locate @gatehouse/core package root")
}

export function useLocalChannelsPlugin() {
  return process.env.GATEHOUSE_DEV === "1" || process.env.CHANNELS_LOCAL_PLUGIN === "1"
}

export function channelsPluginEntryPath(packageRoot: string) {
  const fromCore = path.join(packageRoot, "src", "channels", "plugin", "index.ts")
  if (existsSync(fromCore)) return fromCore
  const fromChannelsDir = path.join(packageRoot, "plugin", "index.ts")
  if (existsSync(fromChannelsDir)) return fromChannelsDir
  return fromCore
}

export function channelsPluginSpec(packageRoot: string) {
  if (useLocalChannelsPlugin()) {
    return pathToFileURL(channelsPluginEntryPath(packageRoot)).href
  }
  return CHANNELS_PLUGIN_PACKAGE
}

function isChannelsPluginSpec(spec: unknown) {
  if (typeof spec !== "string") return false
  return (
    spec.includes("@gatehouse/core/channels") ||
    (spec.startsWith("file:") && spec.includes("/channels/plugin"))
  )
}

export async function ensureChannelsPluginInOpencodeConfig(projectDir: string, pluginRoot?: string) {
  const root = path.resolve(projectDir)
  const packageRoot = pluginRoot ?? gatehouseCorePackageRoot(path.dirname(fileURLToPath(import.meta.url)))
  const spec = channelsPluginSpec(packageRoot)
  const configPath = projectOpencodeConfigPath(root)
  const source = await readProjectOpencodeConfigText(root)
  const raw = source ? parseJsonc(source.text) : {}
  const config = { ...raw }

  config.$schema = config.$schema ?? "https://opencode.ai/config.json"
  const plugins = Array.isArray(config.plugin) ? config.plugin : []
  const kept = plugins.filter((entry) => {
    const entrySpec = Array.isArray(entry) ? entry[0] : entry
    if (useLocalChannelsPlugin() && isChannelsPluginSpec(entrySpec)) return false
    return true
  })
  const hasSpec = kept.some((entry) => {
    const entrySpec = Array.isArray(entry) ? entry[0] : entry
    return entrySpec === spec
  })

  const writeConfig = async (pluginList: unknown[], meta: { added: boolean; normalized?: boolean }) => {
    config.plugin = pluginList
    await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`)
    return { configPath, spec, ...meta }
  }

  if (!hasSpec) {
    return writeConfig([[spec, {}], ...kept], { added: true })
  }
  if (kept.length !== plugins.length) {
    return writeConfig(kept, { added: false, normalized: true })
  }
  return { configPath, added: false, spec }
}
