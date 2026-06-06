import path from "node:path"
import { existsSync } from "node:fs"
import { resolveChannelStateDir } from "@gatehouse/channels-core"
import type { WeixinBridgeConfig } from "./ilink/types.ts"

function readEnv(name: string, fallback?: string) {
  const value = process.env[name]?.trim()
  if (value) return value
  if (fallback !== undefined) return fallback
  throw new Error(`Missing required env: ${name}`)
}

function readEnvInt(name: string, fallback: number) {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: ${raw}`)
  }
  return parsed
}

function resolveWeixinStateDir(projectDir: string) {
  const stateDir = resolveChannelStateDir(projectDir, "weixin")
  const legacyDir = path.join(projectDir, ".gatehouse", "weixin-bridge")
  if (!existsSync(stateDir) && existsSync(legacyDir)) return legacyDir
  return stateDir
}

export function loadConfig(): WeixinBridgeConfig {
  const projectDir = path.resolve(readEnv("GATEHOUSE_PROJECT_DIR"))
  return {
    projectDir,
    opencodeUrl: readEnv("OPENCODE_URL", "http://127.0.0.1:4096"),
    ilinkBaseUrl: readEnv("WIXIN_ILINK_BASE_URL", "https://ilinkai.weixin.qq.com"),
    cdnBaseUrl: readEnv("WIXIN_CDN_BASE_URL", "https://novac2c.cdn.weixin.qq.com/c2c"),
    botType: readEnv("WIXIN_BOT_TYPE", "3"),
    botAgent: readEnv("WIXIN_BOT_AGENT", "GatehouseLead/0.1.0"),
    leadReplyTimeoutMs: readEnvInt("LEAD_REPLY_TIMEOUT_MS", 600_000),
    stateDir: resolveWeixinStateDir(projectDir),
  }
}
