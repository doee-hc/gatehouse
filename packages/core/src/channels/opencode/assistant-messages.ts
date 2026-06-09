import type { ChannelBridgeConfig } from "../types.ts"
import { textFromPromptResponse } from "./session.ts"
import type { OpencodeClient } from "./client.ts"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function messageInfo(row: Record<string, unknown>) {
  return isRecord(row.info) ? row.info : row
}

function textFromParts(parts: unknown) {
  if (!Array.isArray(parts)) return ""
  return parts
    .filter((part) => isRecord(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => (part as { text: string }).text)
    .join("\n")
    .trim()
}

export function assistantMessageId(row: Record<string, unknown>) {
  const info = messageInfo(row)
  return typeof info.id === "string" ? info.id : undefined
}

export function assistantMessageText(row: Record<string, unknown>) {
  const partsText = textFromParts(row.parts)
  if (partsText) return partsText
  const info = messageInfo(row)
  if (typeof info.content === "string" && info.content.trim()) return info.content.trim()
  return textFromPromptResponse(row)
}

export function isDeliverableAssistantMessage(row: unknown): row is Record<string, unknown> {
  if (!isRecord(row)) return false
  const info = messageInfo(row)
  if (info.role !== "assistant") return false
  if (info.summary === true) return false
  if (info.agent === "compaction") return false
  return Boolean(assistantMessageText(row))
}

export type DeliverableAssistantMessage = {
  id: string
  text: string
}

export async function listSessionMessages(client: OpencodeClient, config: ChannelBridgeConfig, sessionId: string) {
  const messages = await client.session.messages({
    query: { directory: config.projectDir },
    path: { id: sessionId },
  })
  if (messages.error || !Array.isArray(messages.data)) return []
  return messages.data.filter(isRecord)
}

export function collectDeliverableAssistantMessages(
  rows: Record<string, unknown>[],
  afterMessageId?: string,
): DeliverableAssistantMessage[] {
  const collected: DeliverableAssistantMessage[] = []
  let passedWatermark = !afterMessageId
  for (const row of rows) {
    if (!isDeliverableAssistantMessage(row)) continue
    const id = assistantMessageId(row)
    if (!id) continue
    if (!passedWatermark) {
      if (id === afterMessageId) passedWatermark = true
      continue
    }
    if (afterMessageId && id === afterMessageId) continue
    collected.push({ id, text: assistantMessageText(row) })
  }
  return collected
}

export async function listNewDeliverableAssistantMessages(
  client: OpencodeClient,
  config: ChannelBridgeConfig,
  sessionId: string,
  afterMessageId?: string,
) {
  const rows = await listSessionMessages(client, config, sessionId)
  return collectDeliverableAssistantMessages(rows, afterMessageId)
}
