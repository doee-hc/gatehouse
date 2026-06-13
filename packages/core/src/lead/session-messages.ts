import type { PluginInput } from "@opencode-ai/plugin"
import { sessionMessages, type GatehouseClient } from "../session/client.ts"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function messageInfo(row: Record<string, unknown>) {
  return isRecord(row.info) ? row.info : row
}

export function messageRole(row: Record<string, unknown>) {
  const info = messageInfo(row)
  const role = info.role
  return typeof role === "string" ? role : undefined
}

export function messageId(row: Record<string, unknown>) {
  const info = messageInfo(row)
  return typeof info.id === "string" ? info.id : undefined
}

export function lastConversationMessage(rows: Record<string, unknown>[]) {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (!row) continue
    const role = messageRole(row)
    if (role === "user" || role === "assistant") {
      return { role, id: messageId(row) }
    }
  }
  return undefined
}

export async function leadLastConversationMessage(
  plugin: PluginInput,
  leadSessionId: string,
) {
  const rows = await sessionMessages(plugin.client as GatehouseClient, plugin.directory, leadSessionId)
  return lastConversationMessage(rows.filter(isRecord))
}
