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
    issues.push({ level: "error", message: `项目目录不存在: ${projectDir}` })
    return issues
  }
  if (!fs.existsSync(`${projectDir}/.gatehouse`)) {
    issues.push({ level: "error", message: "缺少 .gatehouse/，请先启动 OpenCode 完成 scaffold" })
    return issues
  }

  if (!channelsConfigExists(projectDir)) {
    issues.push({
      level: "warn",
      message: "缺少 .gatehouse/channels.yaml，可运行: bunx @gatehouse/core channels init",
    })
  }

  const config = loadChannelsConfig(projectDir)
  const supervisor = readLiveSupervisorState(projectDir)
  if (supervisor) {
    issues.push({ level: "ok", message: `supervisor 运行中 (pid ${supervisor.pid})` })
  } else {
    issues.push({ level: "warn", message: "supervisor 未运行，可运行: bunx @gatehouse/core channels serve" })
  }

  if (probe) {
    try {
      await verifyOpencode({
        projectDir,
        opencodeUrl: config.opencodeUrl,
        leadReplyTimeoutMs: config.leadReplyTimeoutMs ?? 600_000,
        stateDir: `${projectDir}/.gatehouse/channels/doctor`,
      })
      issues.push({ level: "ok", message: `OpenCode 可达 (${config.opencodeUrl})` })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      issues.push({ level: "error", message })
    }
  } else {
    issues.push({ level: "warn", message: `OpenCode 探测未执行，可加 --probe（目标 ${config.opencodeUrl}）` })
  }

  for (const channelId of CHANNEL_IDS) {
    const channel = config.channels[channelId]
    if (!channel.enabled) {
      issues.push({ level: "ok", channel: channelId, message: "未启用" })
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
        message: `凭证已就绪 (${weixinCredentialsPath(projectDir)})`,
      })
    } else if (channelId === "feishu") {
      issues.push({ level: "ok", channel: channelId, message: "App ID / Secret 已配置" })
    } else if (channelId === "qq-onebot") {
      const onebot = config.channels["qq-onebot"]
      issues.push({
        level: "ok",
        channel: channelId,
        message: `OneBot WS 已配置（${onebot.wsUrl?.trim() || "ws://127.0.0.1:3001"}，requireAt=${onebot.requireAt !== false}）`,
      })
    } else {
      issues.push({
        level: "ok",
        channel: channelId,
        message: `AppID / Secret 已配置（sandbox=${config.channels.qq.sandbox !== false}）`,
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
