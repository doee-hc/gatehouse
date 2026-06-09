import type { ChannelBridgeConfig } from "@gatehouse/core/channels"

export const CHANNEL_VERSION = "gatehouse-weixin-bridge/0.1.0"

export const MessageType = {
  USER: 1,
  BOT: 2,
} as const

export const MessageItemType = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const

export const MessageState = {
  FINISH: 2,
} as const

export interface CDNMedia {
  encrypt_query_param?: string
  aes_key?: string
  encrypt_type?: number
  full_url?: string
}

export interface ImageItem {
  media?: CDNMedia
  thumb_media?: CDNMedia
  aeskey?: string
  url?: string
  mid_size?: number
}

export interface MessageItem {
  type?: number
  text_item?: { text?: string }
  voice_item?: { text?: string }
  image_item?: ImageItem
}

export interface WeixinMessage {
  message_id?: number
  from_user_id?: string
  message_type?: number
  message_state?: number
  item_list?: MessageItem[]
  context_token?: string
}

export interface GetUpdatesResp {
  ret?: number
  errcode?: number
  errmsg?: string
  msgs?: WeixinMessage[]
  get_updates_buf?: string
  longpolling_timeout_ms?: number
}

export interface SendMessageReq {
  msg?: {
    from_user_id?: string
    to_user_id?: string
    client_id?: string
    message_type?: number
    message_state?: number
    item_list?: MessageItem[]
    context_token?: string
  }
}

export interface GetConfigResp {
  ret?: number
  typing_ticket?: string
}

export interface Credentials {
  botToken: string
  accountId?: string
  baseUrl: string
  loggedInAt: number
}

export interface WeixinBridgeConfig extends ChannelBridgeConfig {
  ilinkBaseUrl: string
  cdnBaseUrl: string
  botType: string
  botAgent: string
}
