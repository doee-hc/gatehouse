import { existsSync } from "node:fs"
import path from "node:path"
import { resolveChannelStateDir } from "@gatehouse/channels-core"
import type { FeishuBridgeConfig } from "./feishu/types.ts"

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

function resolveFeishuStateDir(projectDir: string) {
  const stateDir = resolveChannelStateDir(projectDir, "feishu")
  const legacyDir = path.join(projectDir, ".gatehouse", "feishu-bridge")
  if (!existsSync(stateDir) && existsSync(legacyDir)) return legacyDir
  return stateDir
}

export function loadConfig(): FeishuBridgeConfig {
  const projectDir = path.resolve(readEnv("GATEHOUSE_PROJECT_DIR"))
  return {
    projectDir,
    opencodeUrl: readEnv("OPENCODE_URL", "http://127.0.0.1:4096"),
    leadReplyTimeoutMs: readEnvInt("LEAD_REPLY_TIMEOUT_MS", 600_000),
    stateDir: resolveFeishuStateDir(projectDir),
    appId: readEnv("FEISHU_APP_ID"),
    appSecret: readEnv("FEISHU_APP_SECRET"),
    apiBaseUrl: readEnv("FEISHU_API_BASE_URL", "https://open.feishu.cn/open-apis"),
  }
}
