import type { ChannelBridgeConfig } from "@gatehouse/channels-core"

export interface QqBridgeConfig extends ChannelBridgeConfig {
  appId: string
  secret: string
  sandbox: boolean
}

export type QqImageAttachment = {
  url: string
  fileName: string
}

export type QqInboundMessage = {
  eventId: string
  userId: string
  messageType: "text" | "image" | "media"
  text: string
  images: QqImageAttachment[]
}
