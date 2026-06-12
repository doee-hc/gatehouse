import path from "node:path"
import { resolveChannelStateDir } from "@gatehouse/core/channels"
import type { QqOnebotBridgeConfig } from "./onebot/types.ts"

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

function readEnvBool(name: string, fallback: boolean) {
  const raw = process.env[name]?.trim()?.toLowerCase()
  if (!raw) return fallback
  if (raw === "1" || raw === "true" || raw === "yes") return true
  if (raw === "0" || raw === "false" || raw === "no") return false
  throw new Error(`Invalid ${name}: ${process.env[name]}`)
}

function readGroupAllowList() {
  const raw = process.env.QQ_ONEBOT_GROUP_ALLOWLIST?.trim()
  if (!raw) return []
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

export function loadConfig(): QqOnebotBridgeConfig {
  const projectDir = path.resolve(readEnv("GATEHOUSE_PROJECT_DIR"))
  const accessToken = process.env.QQ_ONEBOT_ACCESS_TOKEN?.trim()
  return {
    projectDir,
    opencodeUrl: readEnv("OPENCODE_URL", "http://127.0.0.1:4096"),
    leadReplyTimeoutMs: readEnvInt("LEAD_REPLY_TIMEOUT_MS", 600_000),
    stateDir: resolveChannelStateDir(projectDir, "qq-onebot"),
    wsUrl: readEnv("QQ_ONEBOT_WS_URL", "ws://127.0.0.1:3001"),
    accessToken: accessToken || undefined,
    requireAt: readEnvBool("QQ_ONEBOT_REQUIRE_AT", true),
    groupAllowList: readGroupAllowList(),
  }
}
