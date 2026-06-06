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
  if (item.type === MessageItemType.FILE) return "暂不支持文件，请发送文字描述你的需求。"
  if (item.type === MessageItemType.VIDEO) return "暂不支持视频，请发送文字描述你的需求。"
  if (item.type === MessageItemType.VOICE) return "暂不支持语音，请发送文字描述你的需求。"
  if (item.type === MessageItemType.IMAGE) return "无法解析图片消息，请重试或改用文字描述。"
  return "暂不支持该消息类型，请发送文字。"
}

export function unsupportedMediaReply(msg: WeixinMessage) {
  if (!msg.item_list?.length) return "收到空消息，请发送文字。"
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
  return "请发送文字消息。"
}

