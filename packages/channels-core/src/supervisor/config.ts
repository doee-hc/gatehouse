import fs from "node:fs"
import path from "node:path"
import { resolveChannelStateDir } from "../paths.ts"
import { readJsonFile } from "../store/files.ts"
import {
  CHANNEL_IDS,
  type ChannelId,
  type ChannelsFileConfig,
  type FeishuChannelConfig,
  type QqChannelConfig,
  type WeixinChannelConfig,
} from "./types.ts"

const DEFAULT_CONFIG: ChannelsFileConfig = {
  opencodeUrl: "http://127.0.0.1:4096",
  channels: {
    weixin: { enabled: false },
    feishu: { enabled: false, appId: "", appSecret: "" },
    qq: { enabled: false, appId: "", secret: "", sandbox: true },
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readBool(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value
  return fallback
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback
}

function readPositiveInt(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback
  return Math.floor(value)
}

function parseChannelSection<T extends Record<string, unknown>>(
  raw: unknown,
  defaults: T,
  parse: (entry: Record<string, unknown>, base: T) => T,
): T {
  if (!isRecord(raw)) return defaults
  return parse(raw, defaults)
}

function parseYaml(text: string): unknown {
  if (typeof Bun !== "undefined" && "YAML" in Bun && typeof Bun.YAML.parse === "function") {
    return Bun.YAML.parse(text)
  }
  throw new Error("Bun.YAML.parse is required to read channels.yaml")
}

function stringifyYaml(value: unknown) {
  if (typeof Bun !== "undefined" && "YAML" in Bun && typeof Bun.YAML.stringify === "function") {
    return Bun.YAML.stringify(value)
  }
  throw new Error("Bun.YAML.stringify is required to write channels.yaml")
}

export function gatehouseRoot(projectDir: string) {
  return path.join(projectDir, ".gatehouse")
}

export function channelsConfigPath(projectDir: string) {
  return path.join(gatehouseRoot(projectDir), "channels.yaml")
}

export function resolveProjectDir(cwd: string, explicit?: string) {
  const dir = path.resolve(explicit?.trim() || cwd)
  if (!fs.existsSync(path.join(dir, ".gatehouse"))) {
    throw new Error(`未找到 Gatehouse 项目: ${dir}（缺少 .gatehouse/）`)
  }
  return dir
}

export function channelsConfigExists(projectDir: string) {
  return fs.existsSync(channelsConfigPath(projectDir))
}

export function loadChannelsConfig(projectDir: string): ChannelsFileConfig {
  const configPath = channelsConfigPath(projectDir)
  if (!fs.existsSync(configPath)) return structuredClone(DEFAULT_CONFIG)

  const raw = parseYaml(fs.readFileSync(configPath, "utf-8"))
  if (!isRecord(raw)) throw new Error(`${configPath} 必须是 YAML mapping`)

  const channelsRaw = isRecord(raw.channels) ? raw.channels : {}
  return {
    opencodeUrl: readString(raw.opencodeUrl, DEFAULT_CONFIG.opencodeUrl),
    leadReplyTimeoutMs: readPositiveInt(raw.leadReplyTimeoutMs, 600_000),
    channels: {
      weixin: parseChannelSection(channelsRaw.weixin, DEFAULT_CONFIG.channels.weixin, (entry, base) => ({
        enabled: readBool(entry.enabled, base.enabled),
      })),
      feishu: parseChannelSection(channelsRaw.feishu, DEFAULT_CONFIG.channels.feishu, (entry, base) => ({
        enabled: readBool(entry.enabled, base.enabled),
        appId: readString(entry.appId, base.appId),
        appSecret: readString(entry.appSecret, base.appSecret),
        apiBaseUrl: readString(entry.apiBaseUrl, base.apiBaseUrl),
      })),
      qq: parseChannelSection(channelsRaw.qq, DEFAULT_CONFIG.channels.qq, (entry, base) => ({
        enabled: readBool(entry.enabled, base.enabled),
        appId: readString(entry.appId, base.appId),
        secret: readString(entry.secret, base.secret),
        sandbox: readBool(entry.sandbox, base.sandbox ?? true),
      })),
    },
  }
}

export function saveChannelsConfig(projectDir: string, config: ChannelsFileConfig) {
  const configPath = channelsConfigPath(projectDir)
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, `${stringifyYaml(config)}\n`, "utf-8")
}

export function initChannelsConfig(projectDir: string, overwrite = false) {
  const configPath = channelsConfigPath(projectDir)
  if (fs.existsSync(configPath) && !overwrite) {
    return { created: false, path: configPath }
  }
  saveChannelsConfig(projectDir, structuredClone(DEFAULT_CONFIG))
  return { created: true, path: configPath }
}

export function updateChannelConfig(
  projectDir: string,
  channelId: ChannelId,
  patch: Partial<WeixinChannelConfig | FeishuChannelConfig | QqChannelConfig>,
) {
  const config = loadChannelsConfig(projectDir)
  config.channels[channelId] = { ...config.channels[channelId], ...patch, enabled: true }
  saveChannelsConfig(projectDir, config)
  return config
}

export function setChannelEnabled(projectDir: string, channelId: ChannelId, enabled: boolean) {
  const config = loadChannelsConfig(projectDir)
  config.channels[channelId] = { ...config.channels[channelId], enabled }
  saveChannelsConfig(projectDir, config)
  return config
}

export function weixinCredentialsPath(projectDir: string) {
  return path.join(resolveChannelStateDir(projectDir, "weixin"), "credentials.json")
}

export function isChannelConfigured(projectDir: string, channelId: ChannelId, config: ChannelsFileConfig) {
  if (channelId === "weixin") {
    return Boolean(readJsonFile(weixinCredentialsPath(projectDir)))
  }
  if (channelId === "feishu") {
    const feishu = config.channels.feishu
    return Boolean(feishu.appId?.trim() && feishu.appSecret?.trim())
  }
  const qq = config.channels.qq
  return Boolean(qq.appId?.trim() && qq.secret?.trim())
}

export function listEnabledChannels(config: ChannelsFileConfig, only?: ChannelId[]) {
  const ids = only?.length ? only.filter((id) => CHANNEL_IDS.includes(id)) : [...CHANNEL_IDS]
  return ids.filter((id) => config.channels[id].enabled)
}

export function buildBridgeEnv(projectDir: string, config: ChannelsFileConfig, channelId: ChannelId) {
  const env: Record<string, string> = {
    GATEHOUSE_PROJECT_DIR: projectDir,
    OPENCODE_URL: config.opencodeUrl,
    LEAD_REPLY_TIMEOUT_MS: String(config.leadReplyTimeoutMs ?? 600_000),
  }

  if (channelId === "feishu") {
    const feishu = config.channels.feishu
    env.FEISHU_APP_ID = feishu.appId?.trim() ?? ""
    env.FEISHU_APP_SECRET = feishu.appSecret?.trim() ?? ""
    if (feishu.apiBaseUrl?.trim()) env.FEISHU_API_BASE_URL = feishu.apiBaseUrl.trim()
  }

  if (channelId === "qq") {
    const qq = config.channels.qq
    env.QQ_APP_ID = qq.appId?.trim() ?? ""
    env.QQ_SECRET = qq.secret?.trim() ?? ""
    env.QQ_SANDBOX = qq.sandbox === false ? "false" : "true"
  }

  return env
}

export function validateChannelReady(projectDir: string, channelId: ChannelId, config: ChannelsFileConfig) {
  if (!config.channels[channelId].enabled) {
    return { ok: false as const, reason: "未启用" }
  }
  if (!isChannelConfigured(projectDir, channelId, config)) {
    if (channelId === "weixin") {
      return { ok: false as const, reason: "未登录，请运行: gatehouse channels login weixin" }
    }
    return { ok: false as const, reason: "缺少凭证，请运行: gatehouse channels login " + channelId }
  }
  return { ok: true as const }
}
