import { existsSync } from "node:fs"
import path from "node:path"
import { resolveChannelStateDir } from "@gatehouse/core/channels"
import type { QqBridgeConfig } from "./qq/types.ts"

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

function resolveQqStateDir(projectDir: string) {
  const stateDir = resolveChannelStateDir(projectDir, "qq")
  const legacyDir = path.join(projectDir, ".gatehouse", "qq-bridge")
  if (!existsSync(stateDir) && existsSync(legacyDir)) return legacyDir
  return stateDir
}

export function loadConfig(): QqBridgeConfig {
  const projectDir = path.resolve(readEnv("GATEHOUSE_PROJECT_DIR"))
  return {
    projectDir,
    opencodeUrl: readEnv("OPENCODE_URL", "http://127.0.0.1:4096"),
    leadReplyTimeoutMs: readEnvInt("LEAD_REPLY_TIMEOUT_MS", 600_000),
    stateDir: resolveQqStateDir(projectDir),
    appId: readEnv("QQ_APP_ID"),
    secret: readEnv("QQ_SECRET"),
    sandbox: readEnvBool("QQ_SANDBOX", true),
  }
}
