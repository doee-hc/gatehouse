import type { FeishuInboundMessage } from "./types.ts"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined
}

export function parseTextContent(content: string) {
  const trimmed = content.trim()
  if (!trimmed) return ""
  if (!trimmed.startsWith("{")) return trimmed
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!isRecord(parsed)) return trimmed
    const text = readString(parsed.text)
    return text?.trim() ?? trimmed
  } catch {
    return trimmed
  }
}

export function parseImageKey(content: string) {
  const trimmed = content.trim()
  if (!trimmed.startsWith("{")) return undefined
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!isRecord(parsed)) return undefined
    const imageKey = readString(parsed.image_key)
    return imageKey?.trim() || undefined
  } catch {
    return undefined
  }
}

export function inboundText(message: Pick<FeishuInboundMessage, "messageType" | "content">) {
  if (message.messageType === "text") return parseTextContent(message.content)
  if (message.messageType === "post") return parseTextContent(message.content)
  return ""
}

export function unsupportedMediaReply(messageType: string) {
  if (messageType === "file") return "Files are not supported. Please describe your request in text."
  if (messageType === "audio") return "Voice messages are not supported. Please describe your request in text."
  if (messageType === "media") return "Media messages are not supported. Please describe your request in text."
  if (messageType === "sticker") return "Stickers are not supported. Please describe your request in text."
  return `Unsupported ${messageType} messages. Please send text.`
}

export function shouldHandleMessage(message: FeishuInboundMessage) {
  if (message.chatType === "p2p") return true
  if (message.chatType === "group") return true
  return false
}

export function normalizeFeishuEvent(data: Record<string, unknown>): FeishuInboundMessage | undefined {
  const message = isRecord(data.message) ? data.message : undefined
  const sender = isRecord(data.sender) ? data.sender : undefined
  if (!message || !sender) return undefined
  if (readString(sender.sender_type) === "app") return undefined

  const senderId = isRecord(sender.sender_id) ? sender.sender_id : undefined
  const userId = readString(senderId?.open_id) ?? readString(senderId?.user_id) ?? ""
  const chatId = readString(message.chat_id) ?? ""
  const messageId = readString(message.message_id) ?? ""
  const chatType = readString(message.chat_type) === "group" ? "group" : "p2p"
  const messageType = readString(message.message_type) ?? "unknown"
  const content = readString(message.content) ?? ""
  const mentions = Array.isArray(message.mentions) ? message.mentions : []
  const mentionsBot = mentions.some((item) => isRecord(item) && readString(item.name)?.includes("bot"))

  if (!userId || !chatId || !messageId) return undefined

  const header = isRecord(data.header) ? data.header : undefined
  const eventId =
    readString(data.event_id) ??
    readString(header?.event_id) ??
    messageId

  return {
    eventId,
    messageId,
    chatId,
    chatType,
    userId,
    messageType,
    content,
    mentionsBot,
  }
}
