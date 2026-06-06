import type { PrivateMessageEvent } from "qq-official-bot"
import type { QqImageAttachment, QqInboundMessage } from "./types.ts"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function textFromSegments(message: unknown) {
  if (!Array.isArray(message)) return ""
  return message
    .flatMap((item): string[] => {
      if (!isRecord(item)) return []
      if (item.type === "text" && isRecord(item.data)) {
        const text = typeof item.data.text === "string" ? item.data.text : undefined
        return text ? [text] : []
      }
      if (item.type === "markdown" && isRecord(item.data)) {
        const text =
          (typeof item.data.content === "string" ? item.data.content : undefined) ??
          (typeof item.data.text === "string" ? item.data.text : undefined)
        return text ? [text] : []
      }
      return []
    })
    .join("")
    .trim()
}

function imagesFromSegments(message: unknown): QqImageAttachment[] {
  if (!Array.isArray(message)) return []
  return message.flatMap((item): QqImageAttachment[] => {
    if (!isRecord(item) || item.type !== "image" || !isRecord(item.data)) return []
    const url = typeof item.data.url === "string" ? item.data.url.trim() : undefined
    if (!url) return []
    const fileName =
      (typeof item.data.name === "string" && item.data.name.trim()) ||
      (typeof item.data.file === "string" && item.data.file.trim()) ||
      "image.png"
    return [{ url, fileName }]
  })
}

function hasUnsupportedMedia(message: unknown) {
  if (!Array.isArray(message)) return false
  return message.some((item) => {
    if (!isRecord(item)) return false
    return item.type === "file" || item.type === "video" || item.type === "record"
  })
}

export function normalizePrivateMessage(event: PrivateMessageEvent): QqInboundMessage | undefined {
  const userId = event.user_id?.trim()
  const eventId = event.id?.trim() || event.message_id?.trim()
  if (!userId || !eventId) return undefined

  const text = event.raw_message?.trim() || textFromSegments(event.message)
  const images = imagesFromSegments(event.message)
  const messageType = hasUnsupportedMedia(event.message) ? "media" : images.length ? "image" : "text"

  return {
    eventId,
    userId,
    messageType,
    text,
    images,
  }
}

export function unsupportedMediaReply() {
  return "暂不支持文件/语音/视频，请发送文字或图片。"
}
