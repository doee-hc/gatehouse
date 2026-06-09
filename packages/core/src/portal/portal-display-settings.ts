import { loadGatehouseConfig, type PortalDisplayConfig } from "../gatehouse-config.ts"
import { getPortalOfficeSettings, toBrowserOfficeConfig } from "./portal-office-settings.ts"

export type PortalDisplaySettings = {
  sseMax: number
  snapshotTtlMs: number
  teamStatsTtlMs: number
  blogTtlMs: number
  corsOrigins?: string[]
  snapshotPollMs: number
  teamStatsPollMs: number
}

const DEFAULT_SSE_MAX = 500
const DEFAULT_SNAPSHOT_TTL_MS = 5_000
const DEFAULT_TEAM_STATS_TTL_MS = 10_000
const DEFAULT_BLOG_TTL_MS = 30_000
const DEFAULT_SNAPSHOT_POLL_MS = 10_000
const DEFAULT_TEAM_STATS_POLL_MS = 8_000

let activeSettings: PortalDisplaySettings | undefined

function positiveInt(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
}

function envPositiveInt(key: string) {
  const raw = process.env[key]?.trim()
  if (!raw) return undefined
  return positiveInt(Number(raw))
}

function envCorsOrigins() {
  const raw = process.env.GATEHOUSE_PORTAL_CORS_ORIGINS?.trim()
  if (!raw) return undefined
  const origins = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
  return origins.length > 0 ? origins : undefined
}

function corsOriginsFromConfig(config?: PortalDisplayConfig) {
  const raw = config?.cors_origins
  if (!Array.isArray(raw)) return undefined
  const origins = raw.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean)
  return origins.length > 0 ? origins : undefined
}

function resolveFromConfig(config?: PortalDisplayConfig): Partial<PortalDisplaySettings> {
  if (!config) return {}
  return {
    ...(positiveInt(config.sse_max) !== undefined && { sseMax: positiveInt(config.sse_max) }),
    ...(positiveInt(config.snapshot_ttl_ms) !== undefined && {
      snapshotTtlMs: positiveInt(config.snapshot_ttl_ms),
    }),
    ...(positiveInt(config.team_stats_ttl_ms) !== undefined && {
      teamStatsTtlMs: positiveInt(config.team_stats_ttl_ms),
    }),
    ...(positiveInt(config.blog_ttl_ms) !== undefined && { blogTtlMs: positiveInt(config.blog_ttl_ms) }),
    ...(corsOriginsFromConfig(config) && { corsOrigins: corsOriginsFromConfig(config) }),
    ...(positiveInt(config.snapshot_poll_ms) !== undefined && {
      snapshotPollMs: positiveInt(config.snapshot_poll_ms),
    }),
    ...(positiveInt(config.team_stats_poll_ms) !== undefined && {
      teamStatsPollMs: positiveInt(config.team_stats_poll_ms),
    }),
  }
}

function resolveFromEnv(): Partial<PortalDisplaySettings> {
  return {
    ...(envPositiveInt("GATEHOUSE_PORTAL_SSE_MAX") !== undefined && {
      sseMax: envPositiveInt("GATEHOUSE_PORTAL_SSE_MAX"),
    }),
    ...(envPositiveInt("GATEHOUSE_PORTAL_SNAPSHOT_TTL_MS") !== undefined && {
      snapshotTtlMs: envPositiveInt("GATEHOUSE_PORTAL_SNAPSHOT_TTL_MS"),
    }),
    ...(envPositiveInt("GATEHOUSE_PORTAL_TEAM_STATS_TTL_MS") !== undefined && {
      teamStatsTtlMs: envPositiveInt("GATEHOUSE_PORTAL_TEAM_STATS_TTL_MS"),
    }),
    ...(envPositiveInt("GATEHOUSE_PORTAL_BLOG_TTL_MS") !== undefined && {
      blogTtlMs: envPositiveInt("GATEHOUSE_PORTAL_BLOG_TTL_MS"),
    }),
    ...(envCorsOrigins() && { corsOrigins: envCorsOrigins() }),
    ...(envPositiveInt("GATEHOUSE_SNAPSHOT_POLL_MS") !== undefined && {
      snapshotPollMs: envPositiveInt("GATEHOUSE_SNAPSHOT_POLL_MS"),
    }),
    ...(envPositiveInt("GATEHOUSE_TEAM_STATS_POLL_MS") !== undefined && {
      teamStatsPollMs: envPositiveInt("GATEHOUSE_TEAM_STATS_POLL_MS"),
    }),
  }
}

export function resolvePortalDisplaySettings(projectDirectory: string): PortalDisplaySettings {
  const fromConfig = resolveFromConfig(loadGatehouseConfig(projectDirectory).portal.display)
  const fromEnv = resolveFromEnv()

  return {
    sseMax: fromEnv.sseMax ?? fromConfig.sseMax ?? DEFAULT_SSE_MAX,
    snapshotTtlMs: fromEnv.snapshotTtlMs ?? fromConfig.snapshotTtlMs ?? DEFAULT_SNAPSHOT_TTL_MS,
    teamStatsTtlMs: fromEnv.teamStatsTtlMs ?? fromConfig.teamStatsTtlMs ?? DEFAULT_TEAM_STATS_TTL_MS,
    blogTtlMs: fromEnv.blogTtlMs ?? fromConfig.blogTtlMs ?? DEFAULT_BLOG_TTL_MS,
    corsOrigins: fromEnv.corsOrigins ?? fromConfig.corsOrigins,
    snapshotPollMs: fromEnv.snapshotPollMs ?? fromConfig.snapshotPollMs ?? DEFAULT_SNAPSHOT_POLL_MS,
    teamStatsPollMs: fromEnv.teamStatsPollMs ?? fromConfig.teamStatsPollMs ?? DEFAULT_TEAM_STATS_POLL_MS,
  }
}

export function initPortalDisplaySettings(projectDirectory: string) {
  activeSettings = resolvePortalDisplaySettings(projectDirectory)
  return activeSettings
}

export function getPortalDisplaySettings() {
  if (activeSettings) return activeSettings
  const projectDirectory = process.env.GATEHOUSE_PROJECT_DIR?.trim()
  if (projectDirectory) return resolvePortalDisplaySettings(projectDirectory)
  return resolvePortalDisplaySettings(process.cwd())
}

export function resetPortalDisplaySettingsForTests() {
  activeSettings = undefined
}

export function toBrowserDisplayConfig(settings: PortalDisplaySettings) {
  return {
    snapshot_poll_ms: settings.snapshotPollMs,
    team_stats_poll_ms: settings.teamStatsPollMs,
    office: toBrowserOfficeConfig(getPortalOfficeSettings()),
  }
}
