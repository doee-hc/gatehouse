import type { ChannelBridgeConfig } from "@gatehouse/channels-core"

export interface FeishuBridgeConfig extends ChannelBridgeConfig {
  appId: string
  appSecret: string
  apiBaseUrl: string
}

export type FeishuInboundMessage = {
  eventId: string
  messageId: string
  chatId: string
  chatType: "p2p" | "group"
  userId: string
  messageType: string
  content: string
  mentionsBot: boolean
}

export type FeishuApiResponse = {
  code: number
  msg: string
  data?: Record<string, unknown>
}
