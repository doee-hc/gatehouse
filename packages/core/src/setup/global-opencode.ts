import path from "node:path"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { DEFAULT_GATEHOUSE_LOCALE, type GatehouseLocale } from "../locale.ts"
import { defaultAgentNames, renderAgentPrompt, renderGatehouseTemplate, type OuterProfile } from "../names.ts"
import { injectAgentPermissionYaml } from "./permissions.ts"
import { GATEHOUSE_NPM_PACKAGE, gatehouseTuiPluginSpec, useLocalPluginEntry } from "./package.ts"
import { parseJsoncConfig } from "./jsonc.ts"
import {
  legacyProjectOpencodeConfigPath,
  migrateLegacyProjectOpencodeConfig as migrateLegacyProjectOpencodeConfigShared,
  projectOpencodeConfigPath,
  readProjectOpencodeConfigText,
} from "../channels/project-opencode-config.ts"
import { bundledOpencodeTemplateRoot } from "../template-paths.ts"

const agentProfileByFile: Record<string, OuterProfile> = {
  "lead.md": "lead",
  "architect.md": "architect",
  "curator.md": "curator",
  "arbiter.md": "arbiter",
}

export function globalOpencodeConfigDir() {
  const fromEnv = process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  return path.join(homedir(), ".config", "opencode")
}

export function globalOpencodeAgentDir() {
  return path.join(globalOpencodeConfigDir(), "agent")
}

export function globalOpencodeAgentPath(filename: string) {
  return path.join(globalOpencodeAgentDir(), filename)
}

export function detectGlobalOpencodeConfigPath() {
  const configDir = globalOpencodeConfigDir()
  const jsonc = path.join(configDir, "opencode.jsonc")
  if (existsSync(jsonc)) return jsonc
  const json = path.join(configDir, "opencode.json")
  if (existsSync(json)) return json
  return jsonc
}

export function readGlobalOpencodeConfig() {
  const configPath = detectGlobalOpencodeConfigPath()
  if (!existsSync(configPath)) return { configPath, config: undefined as Record<string, unknown> | undefined }
  return {
    configPath,
    config: parseJsoncConfig(readFileSync(configPath, "utf8"), configPath) as Record<string, unknown>,
  }
}

export function readGlobalOpencodeTuiConfig() {
  const configDir = globalOpencodeConfigDir()
  const tuiPath = path.join(configDir, "tui.json")
  if (!existsSync(tuiPath)) return { tuiPath, config: undefined as Record<string, unknown> | undefined }
  return {
    tuiPath,
    config: parseJsoncConfig(readFileSync(tuiPath, "utf8"), tuiPath) as Record<string, unknown>,
  }
}

export function extractOpencodePluginSpecs(config: Record<string, unknown> | undefined) {
  if (!config) return [] as string[]
  const plugin = config.plugin
  if (!Array.isArray(plugin)) return []
  return plugin
    .map((entry) => (Array.isArray(entry) ? entry[0] : entry))
    .filter((spec): spec is string => typeof spec === "string")
}

export function isGatehouseServerPluginSpec(spec: string) {
  if (spec.includes("/tui")) return false
  return (
    spec === "@gatehouse/core" ||
    spec.includes("gatehouse.core") ||
    spec.includes("gatehouse-core") ||
    spec.includes("gatehouse-plugin") ||
    (spec.startsWith("file:") && spec.includes("gatehouse"))
  )
}

export function isGatehouseTuiPluginSpec(spec: string) {
  return (
    spec === GATEHOUSE_NPM_PACKAGE ||
    spec.includes("@gatehouse/core/tui") ||
    spec.includes("gatehouse.tui") ||
    /[/\\]tui[/\\]index\.(ts|tsx|js|mjs|cjs)(?:[?#].*)?$/.test(spec)
  )
}

export const MANAGED_GLOBAL_AGENT_FILES = ["lead.md", "architect.md", "curator.md", "arbiter.md"] as const

/** Gatehouse-owned agent definitions synced to ~/.config/opencode/agent/. */
export const SYNCED_GLOBAL_AGENT_FILES = [
  ...MANAGED_GLOBAL_AGENT_FILES,
  "build-root.md",
  "build-root-solo.md",
  "build-coordinator.md",
  "build.md",
] as const

export { legacyProjectOpencodeConfigPath, projectOpencodeConfigPath }

export async function readProjectOpencodeConfig(projectRoot: string) {
  const source = await readProjectOpencodeConfigText(projectRoot)
  if (!source) return {}
  return parseJsoncConfig(source.text, source.filepath)
}

export async function migrateLegacyProjectOpencodeConfig(projectRoot: string) {
  await migrateLegacyProjectOpencodeConfigShared(projectRoot)
}

/** Sync managed Gatehouse agent definitions into ~/.config/opencode/agent/. */
export async function syncGlobalOpencodeAgents(
  locale: GatehouseLocale = DEFAULT_GATEHOUSE_LOCALE,
  names = defaultAgentNames(),
) {
  const agentTemplateRoot = path.join(bundledOpencodeTemplateRoot(locale), "agent")
  if (!existsSync(agentTemplateRoot)) return

  const destDir = globalOpencodeAgentDir()
  await Bun.$`mkdir -p ${destDir}`.quiet()

  for (const relative of SYNCED_GLOBAL_AGENT_FILES) {
    const source = path.join(agentTemplateRoot, relative)
    if (!existsSync(source)) continue
    const raw = await Bun.file(source).text()
    const profile = agentProfileByFile[relative]
    const text = profile ? renderAgentPrompt(raw, names, profile) : renderGatehouseTemplate(raw, names)
    await Bun.write(path.join(destDir, relative), injectAgentPermissionYaml(text, relative))
  }
}

function isGatehousePluginSpec(spec: unknown) {
  if (typeof spec !== "string") return false
  return (
    spec.includes("gatehouse-plugin") ||
    spec.includes("gatehouse-core") ||
    spec.includes("gatehouse.core") ||
    spec.includes("gatehouse.tui") ||
    spec.includes("@gatehouse/core") ||
    (spec.startsWith("file:") && spec.includes("gatehouse"))
  )
}

/** Dev-only: point global tui.json at a local file:// Gatehouse TUI plugin. */
export async function ensureGlobalOpencodeTuiDev(pluginRoot: string) {
  if (!useLocalPluginEntry()) return

  const configDir = globalOpencodeConfigDir()
  const tuiPath = path.join(configDir, "tui.json")
  await Bun.$`mkdir -p ${configDir}`.quiet()

  const tuiConfig = existsSync(tuiPath)
    ? parseJsoncConfig(readFileSync(tuiPath, "utf8"), tuiPath)
    : { $schema: "https://opencode.ai/tui.json" }

  const tuiPluginSpec = gatehouseTuiPluginSpec(pluginRoot)
  const tuiPlugins = Array.isArray(tuiConfig.plugin) ? tuiConfig.plugin : []
  const kept = tuiPlugins.filter((entry) => {
    const spec = Array.isArray(entry) ? entry[0] : entry
    return !isGatehousePluginSpec(spec)
  })
  tuiConfig.plugin = [[tuiPluginSpec, {}], ...kept]
  await Bun.write(tuiPath, `${JSON.stringify(tuiConfig, null, 2)}\n`)
}
