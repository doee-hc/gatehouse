import { MessageItemType, MessageType, type MessageItem, type WeixinMessage } from "./types.ts"

export function inboundText(msg: WeixinMessage) {
  if (!msg.item_list?.length) return ""
  for (const item of msg.item_list) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      return item.text_item.text.trim()
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return item.voice_item.text.trim()
    }
  }
  return ""
}

export function imageItems(msg: WeixinMessage) {
  if (!msg.item_list?.length) return []
  return msg.item_list.filter((item) => item.type === MessageItemType.IMAGE)
}

export function hasDownloadableImages(msg: WeixinMessage) {
  return imageItems(msg).some((item) => {
    const media = item.image_item?.media
    return Boolean(media?.encrypt_query_param || media?.full_url)
  })
}

export function hasUnsupportedMedia(msg: WeixinMessage) {
  if (!msg.item_list?.length) return false
  return msg.item_list.some((item) => {
    if (item.type === MessageItemType.FILE || item.type === MessageItemType.VIDEO) return true
    if (item.type === MessageItemType.VOICE && !item.voice_item?.text) return true
    if (item.type === MessageItemType.IMAGE) {
      const media = item.image_item?.media
      return !media?.encrypt_query_param && !media?.full_url
    }
    return false
  })
}

export function isUserTextMessage(msg: WeixinMessage) {
  if (msg.message_type !== MessageType.USER) return false
  if (inboundText(msg)) return true
  if (hasDownloadableImages(msg)) return true
  return hasUnsupportedMedia(msg)
}

export function mediaNotice(item: MessageItem) {
  if (item.type === MessageItemType.FILE) return "Files are not supported. Please describe your request in text."
  if (item.type === MessageItemType.VIDEO) return "Videos are not supported. Please describe your request in text."
  if (item.type === MessageItemType.VOICE) return "Voice messages are not supported. Please describe your request in text."
  if (item.type === MessageItemType.IMAGE) return "Could not parse image message. Please retry or describe your request in text."
  return "Unsupported message type. Please send text."
}

export function unsupportedMediaReply(msg: WeixinMessage) {
  if (!msg.item_list?.length) return "Received an empty message. Please send text."
  for (const item of msg.item_list) {
    if (
      item.type === MessageItemType.FILE ||
      item.type === MessageItemType.VIDEO ||
      item.type === MessageItemType.VOICE ||
      item.type === MessageItemType.IMAGE
    ) {
      return mediaNotice(item)
    }
  }
  return "Please send a text message."
}

