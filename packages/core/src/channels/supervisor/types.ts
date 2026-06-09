export const CHANNEL_IDS = ["weixin", "feishu", "qq"] as const
export type ChannelId = (typeof CHANNEL_IDS)[number]

export type WeixinChannelConfig = {
  enabled: boolean
}

export type FeishuChannelConfig = {
  enabled: boolean
  appId?: string
  appSecret?: string
  apiBaseUrl?: string
}

export type QqChannelConfig = {
  enabled: boolean
  appId?: string
  secret?: string
  sandbox?: boolean
}

export type ChannelsFileConfig = {
  opencodeUrl: string
  leadReplyTimeoutMs?: number
  channels: {
    weixin: WeixinChannelConfig
    feishu: FeishuChannelConfig
    qq: QqChannelConfig
  }
}

export type ChannelRuntimeStatus = "starting" | "running" | "stopped" | "failed"

export type ChannelProcessState = {
  pid?: number
  status: ChannelRuntimeStatus
  restarts: number
  startedAt?: number
  stoppedAt?: number
  lastError?: string
}

export type SupervisorState = {
  pid: number
  projectDir: string
  startedAt: number
  opencodeUrl: string
  channels: Partial<Record<ChannelId, ChannelProcessState>>
}

export type ChannelListEntry = {
  id: ChannelId
  enabled: boolean
  configured: boolean
  runtime?: ChannelProcessState
}
