import type { ChannelBridgeConfig } from "../types.ts"
import { createOpencodeClientForBridge, type OpencodeClient } from "./client.ts"

const LEAD_AGENT = "lead"

export type ChannelPromptFile = {
  path: string
  mime: string
  filename?: string
}

type PromptPart =
  | { type: "text"; text: string }
  | { type: "file"; url: string; mime: string; filename?: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function createChannelClient(config: ChannelBridgeConfig) {
  return createOpencodeClientForBridge(config)
}

export async function waitForSessionIdle(
  client: OpencodeClient,
  config: ChannelBridgeConfig,
  sessionId: string,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const status = await client.session.status({
      query: { directory: config.projectDir },
    })
    if (status.error) {
      await Bun.sleep(1500)
      continue
    }
    const entry = isRecord(status.data) ? status.data[sessionId] : undefined
    const type = isRecord(entry) && typeof entry.type === "string" ? entry.type : "idle"
    if (type === "idle") return
    await Bun.sleep(1500)
  }
  throw new Error(`session ${sessionId} timed out after ${timeoutMs}ms`)
}

function textFromParts(parts: unknown) {
  if (!Array.isArray(parts)) return ""
  return parts
    .filter((part) => isRecord(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => (part as { text: string }).text)
    .join("\n")
    .trim()
}

function textFromMessageEntry(entry: unknown) {
  if (!isRecord(entry)) return ""
  const partsText = textFromParts(entry.parts)
  if (partsText) return partsText
  const info = isRecord(entry.info) ? entry.info : undefined
  if (info && typeof info.content === "string" && info.content.trim()) return info.content.trim()
  return textFromPromptResponse(entry)
}

export function textFromPromptResponse(data: unknown) {
  if (!isRecord(data)) return ""
  if (typeof data.content === "string" && data.content.trim()) return data.content.trim()
  const info = isRecord(data.info) ? data.info : undefined
  if (info && typeof info.content === "string" && info.content.trim()) return info.content.trim()
  const partsText = textFromParts(data.parts)
  if (partsText) return partsText
  return ""
}

export async function latestAssistantText(client: OpencodeClient, config: ChannelBridgeConfig, sessionId: string) {
  const messages = await client.session.messages({
    query: { directory: config.projectDir },
    path: { id: sessionId },
  })
  if (messages.error || !Array.isArray(messages.data)) return ""
  for (let i = messages.data.length - 1; i >= 0; i--) {
    const message = messages.data[i]
    if (!isRecord(message) || !isRecord(message.info)) continue
    if (message.info.role !== "assistant") continue
    const text = textFromMessageEntry(message)
    if (text) return text
  }
  return ""
}

function buildPromptParts(text: string, files: ChannelPromptFile[] | undefined): PromptPart[] {
  const parts: PromptPart[] = []
  if (text.trim()) parts.push({ type: "text", text })
  for (const file of files ?? []) {
    parts.push({
      type: "file",
      url: file.path.startsWith("file://") ? file.path : `file://${file.path}`,
      mime: file.mime,
      filename: file.filename,
    })
  }
  if (!parts.length) parts.push({ type: "text", text: "" })
  return parts
}

export async function promptSession(
  client: OpencodeClient,
  config: ChannelBridgeConfig,
  input: { sessionId: string; opencodeAgent: string; text: string; files?: ChannelPromptFile[] },
) {
  const before = await latestAssistantText(client, config, input.sessionId)
  await client.session.promptAsync({
    query: { directory: config.projectDir },
    path: { id: input.sessionId },
    body: {
      agent: input.opencodeAgent,
      parts: buildPromptParts(input.text, input.files),
    },
  })
  await waitForSessionIdle(client, config, input.sessionId, config.leadReplyTimeoutMs)
  const after = await latestAssistantText(client, config, input.sessionId)
  if (after && after !== before) return after
  return after || "Received, but no text reply was returned."
}

export async function promptLead(client: OpencodeClient, config: ChannelBridgeConfig, sessionId: string, text: string) {
  return promptSession(client, config, { sessionId, opencodeAgent: LEAD_AGENT, text })
}

export async function verifyOpencode(config: ChannelBridgeConfig) {
  const client = createChannelClient(config)
  const health = await client.session.list({ query: { directory: config.projectDir } })
  if (health.error) {
    throw new Error(
      `Cannot connect to OpenCode (${config.opencodeUrl}) — run: bun run dev ${config.projectDir}`,
    )
  }
}
