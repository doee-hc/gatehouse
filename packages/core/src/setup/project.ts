import path from "node:path"
import { existsSync, readFileSync } from "node:fs"
import {
  channelsConfigExists,
  corePackageMarkerPath,
  ensureChannelsPluginInOpencodeConfig,
  ensurePortalAdminKey,
} from "@gatehouse/channels-core"
import { LEAD_OPENCODE } from "../registry/types.ts"
import { scaffoldGatehouse } from "../scaffold.ts"
import { syncManagedTemplates } from "./sync-templates.ts"
import {
  DEFAULT_GATEHOUSE_LOCALE,
  type GatehouseLocale,
} from "../locale.ts"
import {
  detectGlobalOpencodeConfigPath,
  globalOpencodeConfigDir,
  migrateLegacyProjectOpencodeConfig,
  projectOpencodeConfigPath,
  syncGlobalOpencodeAgents,
} from "./global-opencode.ts"
import { parseJsoncConfig } from "./jsonc.ts"
import {
  gatehouseCorePluginSpec,
  materializeGatehouseArchive,
  gatehousePackageRoot,
  GATEHOUSE_SERVER_PLUGIN,
  GATEHOUSE_TUI_PLUGIN,
  useLocalPluginEntry,
} from "./package.ts"

export { gatehouseCorePluginSpec, gatehouseTuiPluginSpec } from "./package.ts"
export { parseJsoncConfig } from "./jsonc.ts"
export {
  globalOpencodeAgentPath,
  globalOpencodeConfigDir,
  projectOpencodeConfigPath,
} from "./global-opencode.ts"

export type PrepareGatehouseProjectOptions = {
  gatehouseRepoRoot?: string
}

function isChannelsPluginSpec(spec: unknown) {
  if (typeof spec !== "string") return false
  return (
    spec.includes("@gatehouse/channels-core") ||
    (spec.startsWith("file:") && spec.includes("channels-core"))
  )
}

function isGatehousePluginSpec(spec: unknown) {
  if (typeof spec !== "string") return false
  if (isChannelsPluginSpec(spec)) return false
  return (
    spec.includes("gatehouse-plugin") ||
    spec.includes("gatehouse-core") ||
    spec.includes("gatehouse.core") ||
    spec.includes("gatehouse.tui") ||
    spec.includes("@gatehouse/core") ||
    (spec.startsWith("file:") && spec.includes("gatehouse"))
  )
}

function isGatehouseTuiPluginSpec(spec: unknown) {
  if (typeof spec !== "string") return false
  return (
    spec.includes("gatehouse.tui") ||
    spec.includes("@gatehouse/core/tui") ||
    /[/\\]tui[/\\]index\.(ts|tsx|js|mjs|cjs)(?:[?#].*)?$/.test(spec)
  )
}

export async function ensureOpencodeConfig(
  projectRoot: string,
  pluginRoot?: string,
  _options?: PrepareGatehouseProjectOptions,
) {
  const root = path.resolve(projectRoot)
  const packageRoot = path.resolve(pluginRoot ?? gatehousePackageRoot())
  const configPath = projectOpencodeConfigPath(root)
  const pluginSpec = gatehouseCorePluginSpec(packageRoot)

  await migrateLegacyProjectOpencodeConfig(root)

  const config = (await Bun.file(configPath).exists())
    ? parseJsoncConfig(await Bun.file(configPath).text(), configPath)
    : {}

  config.$schema = config.$schema ?? "https://opencode.ai/config.json"
  if (typeof config.default_agent !== "string") config.default_agent = LEAD_OPENCODE

  const skills = (config.skills ??= {}) as { paths?: string[] }
  const skillPaths = Array.isArray(skills.paths) ? skills.paths : []
  if (!skillPaths.includes(".gatehouse")) skills.paths = [...skillPaths, ".gatehouse"]

  {
    const plugins = Array.isArray(config.plugin) ? config.plugin : []
    const kept = plugins.filter((entry) => {
      const spec = Array.isArray(entry) ? entry[0] : entry
      if (isGatehouseTuiPluginSpec(spec)) return false
      if (useLocalPluginEntry() && isGatehousePluginSpec(spec)) return false
      return true
    })
    config.plugin = useLocalPluginEntry() ? [[pluginSpec, {}], ...kept] : kept
  }

  await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`)

  if (channelsConfigExists(root)) {
    await ensureChannelsPluginInOpencodeConfig(root).catch(() => undefined)
  }

  await Bun.write(corePackageMarkerPath(root), `${packageRoot}\n`)
  await Bun.write(
    path.join(root, ".gatehouse/layout.json"),
    `${JSON.stringify({ schema_version: 1, layout: "core-minimal", independent: true }, null, 2)}\n`,
  )
}

export type RegisterGatehouseOptions = {
  locale?: GatehouseLocale
}

function upsertGatehousePluginList(plugins: unknown[], entry: string) {
  const kept = plugins.filter((item) => {
    const spec = Array.isArray(item) ? item[0] : item
    return !isGatehousePluginSpec(spec)
  })
  return [[entry, {}], ...kept]
}

/** Register a local .tgz (or unpacked dir) in global OpenCode config. */
export async function registerGatehouseArchiveInGlobalOpencodeConfig(
  archivePath: string,
  options?: RegisterGatehouseOptions,
) {
  const spec = await materializeGatehouseArchive(archivePath)
  const configDir = globalOpencodeConfigDir()
  const configPath = detectGlobalOpencodeConfigPath()
  await Bun.$`mkdir -p ${configDir}`.quiet()
  await syncGlobalOpencodeAgents(options?.locale ?? DEFAULT_GATEHOUSE_LOCALE)

  const config = existsSync(configPath)
    ? parseJsoncConfig(readFileSync(configPath, "utf8"), configPath)
    : { $schema: "https://opencode.ai/config.json" }

  const plugins = Array.isArray(config.plugin) ? config.plugin : []
  config.plugin = upsertGatehousePluginList(plugins, spec)
  await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`)

  const tuiPath = path.join(configDir, "tui.json")
  const tuiConfig = existsSync(tuiPath)
    ? parseJsoncConfig(readFileSync(tuiPath, "utf8"), tuiPath)
    : { $schema: "https://opencode.ai/tui.json" }
  const tuiPlugins = Array.isArray(tuiConfig.plugin) ? tuiConfig.plugin : []
  tuiConfig.plugin = upsertGatehousePluginList(tuiPlugins, spec)
  await Bun.write(tuiPath, `${JSON.stringify(tuiConfig, null, 2)}\n`)

  return { configPath, spec }
}

/** Register Gatehouse in ~/.config/opencode (oh-my style one-time setup). */
export async function registerGatehouseInGlobalOpencodeConfig(options?: RegisterGatehouseOptions) {
  const configDir = globalOpencodeConfigDir()
  const configPath = detectGlobalOpencodeConfigPath()
  await Bun.$`mkdir -p ${configDir}`.quiet()
  await syncGlobalOpencodeAgents(options?.locale ?? DEFAULT_GATEHOUSE_LOCALE)

  const config = existsSync(configPath)
    ? parseJsoncConfig(readFileSync(configPath, "utf8"), configPath)
    : { $schema: "https://opencode.ai/config.json" }

  const plugins = Array.isArray(config.plugin) ? config.plugin : []
  config.plugin = upsertGatehousePluginList(plugins, GATEHOUSE_SERVER_PLUGIN)
  await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`)

  const tuiPath = path.join(configDir, "tui.json")
  const tuiConfig = existsSync(tuiPath)
    ? parseJsoncConfig(readFileSync(tuiPath, "utf8"), tuiPath)
    : { $schema: "https://opencode.ai/tui.json" }
  const tuiPlugins = Array.isArray(tuiConfig.plugin) ? tuiConfig.plugin : []
  tuiConfig.plugin = upsertGatehousePluginList(tuiPlugins, GATEHOUSE_TUI_PLUGIN)
  await Bun.write(tuiPath, `${JSON.stringify(tuiConfig, null, 2)}\n`)

  return configPath
}

export async function prepareGatehouseProject(
  projectRoot: string,
  pluginRoot?: string,
  options?: PrepareGatehouseProjectOptions,
) {
  await syncManagedTemplates(projectRoot)
  await scaffoldGatehouse(projectRoot)
  ensurePortalAdminKey(projectRoot)
  await ensureOpencodeConfig(projectRoot, pluginRoot, options)
}
