import type { QqOnebotBridgeConfig, QqOnebotInboundMessage, OnebotImageAttachment } from "./types.ts"

type MessageSegment = {
  type: string
  data?: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function asSegments(message: unknown): MessageSegment[] {
  if (Array.isArray(message)) {
    return message.flatMap((item): MessageSegment[] => {
      if (!isRecord(item)) return []
      const type = readString(item.type)
      if (!type) return []
      const data = isRecord(item.data) ? item.data : undefined
      return [{ type, data }]
    })
  }
  if (typeof message === "string") return parseCqCodeSegments(message)
  return []
}

function parseCqCodeSegments(message: string): MessageSegment[] {
  const segments: MessageSegment[] = []
  const pattern = /\[CQ:([^,\]]+)((?:,[^,\]]+)*)\]/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(message)) !== null) {
    const before = message.slice(lastIndex, match.index)
    if (before) segments.push({ type: "text", data: { text: before } })
    const type = match[1]!
    const params = Object.fromEntries(
      (match[2] ?? "")
        .split(",")
        .filter(Boolean)
        .map((part) => {
          const [key, ...rest] = part.split("=")
          return [key, rest.join("=").replace(/&#44;/g, ",").replace(/&amp;/g, "&")]
        }),
    )
    segments.push({ type, data: params })
    lastIndex = pattern.lastIndex
  }

  const tail = message.slice(lastIndex)
  if (tail) segments.push({ type: "text", data: { text: tail } })
  return segments
}

export function textFromMessage(message: unknown) {
  return asSegments(message)
    .flatMap((segment): string[] => {
      if (segment.type !== "text" && segment.type !== "markdown") return []
      const text = readString(segment.data?.text) ?? readString(segment.data?.content)
      return text ? [text] : []
    })
    .join("")
    .trim()
}

function imagesFromMessage(message: unknown): OnebotImageAttachment[] {
  return asSegments(message).flatMap((segment): OnebotImageAttachment[] => {
    if (segment.type !== "image" || !segment.data) return []
    const url =
      readString(segment.data.url)?.trim() ||
      readString(segment.data.file)?.trim() ||
      readString(segment.data.path)?.trim()
    if (!url || url.startsWith("file://")) return []
    const fileName =
      readString(segment.data.name)?.trim() ||
      readString(segment.data.filename)?.trim() ||
      "image.png"
    return [{ url, fileName }]
  })
}

function hasUnsupportedMedia(message: unknown) {
  return asSegments(message).some((segment) => {
    return segment.type === "file" || segment.type === "video" || segment.type === "record"
  })
}

export function mentionsBot(message: unknown, selfId: string) {
  const normalizedSelfId = selfId.trim()
  if (!normalizedSelfId) return false
  return asSegments(message).some((segment) => {
    if (segment.type !== "at" || !segment.data) return false
    const qq = readString(segment.data.qq)?.trim()
    return qq === normalizedSelfId || qq === "all"
  })
}

export function buildSessionKey(groupId: string, userId: string) {
  return `group:${groupId}:user:${userId}`
}

export function shouldHandleGroupMessage(
  config: Pick<QqOnebotBridgeConfig, "groupAllowList">,
  groupId: string,
) {
  if (!config.groupAllowList.length) return true
  return config.groupAllowList.includes(groupId)
}

export function normalizeGroupMessage(
  event: Record<string, unknown>,
  config: Pick<QqOnebotBridgeConfig, "requireAt" | "groupAllowList">,
  selfId: string,
): QqOnebotInboundMessage | undefined {
  if (readString(event.post_type) !== "message") return undefined
  if (readString(event.message_type) !== "group") return undefined

  const groupId = readString(event.group_id)?.trim()
  const userId = readString(event.user_id)?.trim()
  const messageId = readString(event.message_id)?.trim()
  if (!groupId || !userId || !messageId) return undefined
  if (userId === selfId) return undefined
  if (!shouldHandleGroupMessage(config, groupId)) return undefined
  if (config.requireAt && !mentionsBot(event.message, selfId)) return undefined

  const text = textFromMessage(event.message)
  const images = imagesFromMessage(event.message)
  const messageType = hasUnsupportedMedia(event.message) ? "media" : images.length ? "image" : "text"

  return {
    eventId: messageId,
    messageId,
    groupId,
    userId,
    sessionKey: buildSessionKey(groupId, userId),
    messageType,
    text,
    images,
  }
}

export function unsupportedMediaReply() {
  return "暂不支持文件/语音/视频，请发送文字或图片。"
}
