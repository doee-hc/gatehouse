import fs from "node:fs"
import {
  channelsConfigExists,
  isChannelConfigured,
  loadChannelsConfig,
  validateChannelReady,
  weixinCredentialsPath,
} from "./config.ts"
import { verifyOpencode } from "../opencode/session.ts"
import { CHANNEL_IDS, type ChannelId } from "./types.ts"
import { readLiveSupervisorState } from "./state.ts"

export type DoctorIssue = {
  level: "error" | "warn" | "ok"
  channel?: ChannelId
  message: string
}

export async function runChannelsDoctor(projectDir: string, probe = false): Promise<DoctorIssue[]> {
  const issues: DoctorIssue[] = []

  if (!fs.existsSync(projectDir)) {
    issues.push({ level: "error", message: `Project directory does not exist: ${projectDir}` })
    return issues
  }
  if (!fs.existsSync(`${projectDir}/.gatehouse`)) {
    issues.push({ level: "error", message: "Missing .gatehouse/ — start OpenCode to scaffold first" })
    return issues
  }

  if (!channelsConfigExists(projectDir)) {
    issues.push({
      level: "warn",
      message: "Missing .gatehouse/channels.yaml — run: bunx @gatehouse/core channels init",
    })
  }

  const config = loadChannelsConfig(projectDir)
  const supervisor = readLiveSupervisorState(projectDir)
  if (supervisor) {
    issues.push({ level: "ok", message: `supervisor running (pid ${supervisor.pid})` })
  } else {
    issues.push({ level: "warn", message: "supervisor not running — run: bunx @gatehouse/core channels serve" })
  }

  if (probe) {
    try {
      await verifyOpencode({
        projectDir,
        opencodeUrl: config.opencodeUrl,
        leadReplyTimeoutMs: config.leadReplyTimeoutMs ?? 600_000,
        stateDir: `${projectDir}/.gatehouse/channels/doctor`,
      })
      issues.push({ level: "ok", message: `OpenCode reachable (${config.opencodeUrl})` })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      issues.push({ level: "error", message })
    }
  } else {
    issues.push({ level: "warn", message: `OpenCode probe skipped — pass --probe (target ${config.opencodeUrl})` })
  }

  for (const channelId of CHANNEL_IDS) {
    const channel = config.channels[channelId]
    if (!channel.enabled) {
      issues.push({ level: "ok", channel: channelId, message: "Not enabled" })
      continue
    }

    const ready = validateChannelReady(projectDir, channelId, config)
    if (!ready.ok) {
      issues.push({ level: "error", channel: channelId, message: ready.reason })
      continue
    }

    if (channelId === "weixin") {
      issues.push({
        level: "ok",
        channel: channelId,
        message: `Credentials ready (${weixinCredentialsPath(projectDir)})`,
      })
    } else if (channelId === "feishu") {
      issues.push({ level: "ok", channel: channelId, message: "App ID / Secret configured" })
    } else if (channelId === "qq-onebot") {
      const onebot = config.channels["qq-onebot"]
      issues.push({
        level: "ok",
        channel: channelId,
        message: `OneBot WS configured (${onebot.wsUrl?.trim() || "ws://127.0.0.1:3001"}, requireAt=${onebot.requireAt !== false})`,
      })
    } else {
      issues.push({
        level: "ok",
        channel: channelId,
        message: `AppID / Secret configured (sandbox=${config.channels.qq.sandbox !== false})`,
      })
    }
  }

  return issues
}

export function formatDoctorReport(issues: DoctorIssue[]) {
  return issues
    .map((issue) => {
      const prefix = issue.channel ? `[${issue.channel}] ` : ""
      const tag = issue.level === "error" ? "✗" : issue.level === "warn" ? "!" : "✓"
      return `${tag} ${prefix}${issue.message}`
    })
    .join("\n")
}

export function buildChannelList(projectDir: string) {
  const config = loadChannelsConfig(projectDir)
  const supervisor = readLiveSupervisorState(projectDir)
  return CHANNEL_IDS.map((id) => ({
    id,
    enabled: config.channels[id].enabled,
    configured: isChannelConfigured(projectDir, id, config),
    runtime: supervisor?.channels?.[id],
  }))
}
