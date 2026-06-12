import type { ChannelBridgeConfig } from "@gatehouse/core/channels"

export interface QqOnebotBridgeConfig extends ChannelBridgeConfig {
  wsUrl: string
  accessToken?: string
  requireAt: boolean
  groupAllowList: string[]
}

export type OnebotImageAttachment = {
  url: string
  fileName: string
}

export type QqOnebotInboundMessage = {
  eventId: string
  messageId: string
  groupId: string
  userId: string
  sessionKey: string
  messageType: "text" | "image" | "media"
  text: string
  images: OnebotImageAttachment[]
}
