import { generatePortalAdminKey } from "@gatehouse/channels-core"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import {
  DEFAULT_GATEHOUSE_LOCALE,
  normalizeGatehouseLocale,
  type GatehouseLocale,
} from "./locale.ts"
import { DEFAULT_AGENT_NAMES, OUTER_PROFILES, type OuterProfile } from "./names.ts"
import { gatehouseRoot } from "./paths.ts"

export const GATEHOUSE_CONFIG_SCHEMA_VERSION = 1

export const GATEHOUSE_INNER_MODEL_PROFILES = ["executor", "coordinator"] as const
export type GatehouseInnerModelProfile = (typeof GATEHOUSE_INNER_MODEL_PROFILES)[number]

// Literal list — do not spread OUTER_PROFILES here (names.ts imports this module → TDZ).
export const GATEHOUSE_MODEL_PROFILES = [
  "lead",
  "architect",
  "curator",
  "arbiter",
  ...GATEHOUSE_INNER_MODEL_PROFILES,
] as const
export type GatehouseModelProfile = (typeof GATEHOUSE_MODEL_PROFILES)[number]

export type GatehouseSessionModelRef = {
  providerID: string
  id: string
}

export type GatehouseConfigFile = {
  schema_version?: number
  locale?: string
  portal?: {
    admin_key?: string
    brand?: {
      title?: string
      subtitle?: string
      logo?: string
      icp_text?: string
      icp_url?: string
    }
  }
  agents?: Partial<Record<OuterProfile, { name?: string }>>
  models?: Partial<Record<GatehouseModelProfile, string>>
}

export type PortalBrandConfig = {
  title?: string
  subtitle?: string
  logo_path?: string
  icp_text?: string
  icp_url?: string
}

export type ResolvedGatehouseConfig = {
  locale: GatehouseLocale
  agents: Record<OuterProfile, string>
  models: Partial<Record<GatehouseModelProfile, string>>
  portal: { brand: PortalBrandConfig }
}

export function gatehouseGlobalConfigDir() {
  const fromEnv = process.env.GATEHOUSE_GLOBAL_CONFIG_DIR?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  return path.join(homedir(), ".config", "gatehouse")
}

export function gatehouseGlobalConfigPath() {
  return path.join(gatehouseGlobalConfigDir(), "config.yaml")
}

export function gatehouseProjectConfigPath(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "config.yaml")
}

function readConfigFile(filePath: string) {
  if (!existsSync(filePath)) return undefined
  const parsed = Bun.YAML.parse(readFileSync(filePath, "utf8")) as GatehouseConfigFile
  if (typeof parsed !== "object" || parsed === null) return undefined
  return parsed
}

function mergeAgentNames(
  base: Record<OuterProfile, string>,
  layer: GatehouseConfigFile | undefined,
) {
  if (!layer?.agents) return base
  const next = { ...base }
  for (const profile of OUTER_PROFILES) {
    const name = layer.agents[profile]?.name
    if (typeof name === "string" && name.trim()) next[profile] = name.trim()
  }
  return next
}

function mergeLocale(layer: GatehouseConfigFile | undefined): GatehouseLocale | undefined {
  return normalizeGatehouseLocale(layer?.locale)
}

function mergeModels(
  base: Partial<Record<GatehouseModelProfile, string>>,
  layer: GatehouseConfigFile | undefined,
) {
  if (!layer?.models) return base
  const next = { ...base }
  for (const profile of GATEHOUSE_MODEL_PROFILES) {
    const model = layer.models[profile]
    if (typeof model === "string" && model.trim()) next[profile] = model.trim()
  }
  return next
}

export function parseGatehouseModel(model: string): GatehouseSessionModelRef {
  const trimmed = model.trim()
  const slash = trimmed.indexOf("/")
  if (slash <= 0 || slash === trimmed.length - 1) {
    throw new Error(`Invalid model "${model}": expected provider/model-id`)
  }
  return {
    providerID: trimmed.slice(0, slash),
    id: trimmed.slice(slash + 1),
  }
}

export function sessionModelFromConfig(model: string | undefined) {
  if (!model) return undefined
  return parseGatehouseModel(model)
}

export function modelForOuterProfile(
  models: ResolvedGatehouseConfig["models"],
  profile: OuterProfile,
) {
  return models[profile]
}

export function modelForInnerProfile(
  models: ResolvedGatehouseConfig["models"],
  profile: string,
) {
  if (profile === "build") return models.executor
  if (profile === "build-coordinator") return models.coordinator
  return undefined
}

function mergeBrand(base: PortalBrandConfig, layer: GatehouseConfigFile | undefined, configDir: string) {
  const brand = layer?.portal?.brand
  if (!brand) return base
  const next = { ...base }
  if (typeof brand.title === "string" && brand.title.trim()) next.title = brand.title.trim()
  if (typeof brand.subtitle === "string" && brand.subtitle.trim()) next.subtitle = brand.subtitle.trim()
  if (typeof brand.icp_text === "string" && brand.icp_text.trim()) next.icp_text = brand.icp_text.trim()
  if (typeof brand.icp_url === "string" && brand.icp_url.trim()) {
    const icpUrl = brand.icp_url.trim()
    if (isHttpUrl(icpUrl)) next.icp_url = icpUrl
  }
  if (typeof brand.logo === "string" && brand.logo.trim()) {
    next.logo_path = resolveLogoPath(brand.logo.trim(), configDir)
  }
  return next
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

export function resolveLogoPath(logo: string, baseDir: string) {
  return path.isAbsolute(logo) ? path.resolve(logo) : path.resolve(baseDir, logo)
}

export function isAllowedLogoPath(filePath: string, projectDirectory: string) {
  const resolved = path.resolve(filePath)
  const allowedRoots = [
    path.resolve(projectDirectory),
    gatehouseGlobalConfigDir(),
    gatehouseRoot(projectDirectory),
  ]
  return allowedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))
}

export function loadGatehouseConfig(projectDirectory: string): ResolvedGatehouseConfig {
  const globalPath = gatehouseGlobalConfigPath()
  const projectPath = gatehouseProjectConfigPath(projectDirectory)
  const global = readConfigFile(globalPath)
  const project = readConfigFile(projectPath)

  const agents = mergeAgentNames(mergeAgentNames({ ...DEFAULT_AGENT_NAMES }, global), project)
  const models = mergeModels(mergeModels({}, global), project)
  const locale = mergeLocale(project) ?? mergeLocale(global) ?? DEFAULT_GATEHOUSE_LOCALE

  let portalBrand = mergeBrand({}, global, gatehouseGlobalConfigDir())
  portalBrand = mergeBrand(portalBrand, project, gatehouseRoot(projectDirectory))

  return { agents, models, locale, portal: { brand: portalBrand } }
}

export function configYamlTemplate(names = DEFAULT_AGENT_NAMES) {
  return `${Bun.YAML.stringify({
    schema_version: GATEHOUSE_CONFIG_SCHEMA_VERSION,
    locale: DEFAULT_GATEHOUSE_LOCALE,
    portal: {
      admin_key: generatePortalAdminKey(),
      brand: {
        title: "Gatehouse",
        subtitle: "团队门户",
        logo: "brand/logo.png",
        icp_text: "",
        icp_url: "",
      },
    },
    agents: Object.fromEntries(OUTER_PROFILES.map((profile) => [profile, { name: names[profile] }])),
  }, null, 2)}\n`
}

export type EnsureGlobalGatehouseConfigOptions = {
  locale?: GatehouseLocale
  model?: string
}

/** Initialize or update ~/.config/gatehouse/config.yaml during install. */
export async function ensureGlobalGatehouseConfig(options: EnsureGlobalGatehouseConfigOptions = {}) {
  const configDir = gatehouseGlobalConfigDir()
  const configPath = gatehouseGlobalConfigPath()
  await Bun.$`mkdir -p ${configDir}`.quiet()

  const existing = readConfigFile(configPath)
  const locale =
    options.locale ??
    mergeLocale(existing) ??
    DEFAULT_GATEHOUSE_LOCALE

  if (options.model?.trim()) {
    parseGatehouseModel(options.model)
  }

  if (existing && !options.locale && !options.model?.trim()) {
    return { configPath, created: false, updated: false }
  }

  const config: GatehouseConfigFile = existing ?? {
    schema_version: GATEHOUSE_CONFIG_SCHEMA_VERSION,
    portal: {
      brand: {
        title: "Gatehouse",
        subtitle: locale === "zh" ? "团队门户" : "Team Portal",
        logo: "brand/logo.png",
      },
    },
    agents: Object.fromEntries(
      OUTER_PROFILES.map((profile) => [profile, { name: DEFAULT_AGENT_NAMES[profile] }]),
    ),
  }

  if (options.locale) config.locale = locale
  else if (!existing) config.locale = locale

  if (options.model?.trim()) {
    const model = options.model.trim()
    config.models = { ...(config.models ?? {}) }
    for (const profile of GATEHOUSE_MODEL_PROFILES) {
      config.models[profile] = model
    }
  }

  await Bun.write(configPath, `${Bun.YAML.stringify(config, null, 2)}\n`)
  return { configPath, created: !existing, updated: Boolean(existing) }
}
