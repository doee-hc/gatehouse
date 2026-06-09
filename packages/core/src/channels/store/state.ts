import path from "node:path"
import { DEFAULT_AGENT_ID } from "../constants.ts"
import { readRegistryAgentById } from "../registry/agent-target.ts"
import type { UserChatState } from "../types.ts"
import { readJsonFile, writeJsonFile } from "./files.ts"

const SYNC_FILE = "sync-buf.json"
const SESSIONS_FILE = "sessions.json"

export type SessionMap = Record<string, UserChatState>

export function loadSyncBuf(stateDir: string) {
  const data = readJsonFile<{ get_updates_buf?: string }>(path.join(stateDir, SYNC_FILE))
  return data?.get_updates_buf ?? ""
}

export function saveSyncBuf(stateDir: string, getUpdatesBuf: string) {
  writeJsonFile(path.join(stateDir, SYNC_FILE), { get_updates_buf: getUpdatesBuf })
}

export function loadSessionMap(stateDir: string): SessionMap {
  return readJsonFile<SessionMap>(path.join(stateDir, SESSIONS_FILE)) ?? {}
}

export function saveSessionMap(stateDir: string, sessions: SessionMap) {
  writeJsonFile(path.join(stateDir, SESSIONS_FILE), sessions)
}

export function isMessageProcessed(stateDir: string, userId: string, messageId: number) {
  const last = loadSessionMap(stateDir)[userId]?.lastMessageId
  return last !== undefined && messageId <= last
}

export function getActiveAgentId(stateDir: string, userId: string) {
  return loadSessionMap(stateDir)[userId]?.activeAgentId?.trim() || DEFAULT_AGENT_ID
}

export function setActiveAgentId(stateDir: string, userId: string, agentId: string) {
  const sessions = loadSessionMap(stateDir)
  sessions[userId] = { ...sessions[userId], activeAgentId: agentId.trim() }
  saveSessionMap(stateDir, sessions)
}

export function rememberLastMessage(stateDir: string, userId: string, messageId: number) {
  const sessions = loadSessionMap(stateDir)
  const current = sessions[userId]?.lastMessageId ?? 0
  if (messageId <= current) return
  sessions[userId] = { ...sessions[userId], lastMessageId: messageId }
  saveSessionMap(stateDir, sessions)
}

const MAX_RECENT_MESSAGE_KEYS = 100

export function isMessageKeyProcessed(stateDir: string, userId: string, messageKey: string) {
  const trimmed = messageKey.trim()
  if (!trimmed) return false
  const keys = loadSessionMap(stateDir)[userId]?.recentMessageKeys ?? []
  return keys.includes(trimmed)
}

export function rememberMessageKey(stateDir: string, userId: string, messageKey: string) {
  const trimmed = messageKey.trim()
  if (!trimmed) return
  const sessions = loadSessionMap(stateDir)
  const current = sessions[userId]?.recentMessageKeys ?? []
  const next = [...current.filter((key) => key !== trimmed), trimmed].slice(-MAX_RECENT_MESSAGE_KEYS)
  sessions[userId] = { ...sessions[userId], lastMessageKey: trimmed, recentMessageKeys: next }
  saveSessionMap(stateDir, sessions)
}

export function rememberContextToken(stateDir: string, userId: string, contextToken: string) {
  const trimmed = contextToken.trim()
  if (!trimmed) return
  const sessions = loadSessionMap(stateDir)
  sessions[userId] = { ...sessions[userId], lastContextToken: trimmed }
  saveSessionMap(stateDir, sessions)
}

export function getLastContextToken(stateDir: string, userId: string) {
  return loadSessionMap(stateDir)[userId]?.lastContextToken?.trim() ?? ""
}

export function getLastDeliveredAssistantMessageId(stateDir: string, userId: string, sessionId: string) {
  return loadSessionMap(stateDir)[userId]?.lastDeliveredAssistantBySession?.[sessionId]
}

export function setLastDeliveredAssistantMessageId(
  stateDir: string,
  userId: string,
  sessionId: string,
  messageId: string,
) {
  const sessions = loadSessionMap(stateDir)
  const current = sessions[userId]?.lastDeliveredAssistantBySession ?? {}
  sessions[userId] = {
    ...sessions[userId],
    lastDeliveredAssistantBySession: { ...current, [sessionId]: messageId },
  }
  saveSessionMap(stateDir, sessions)
}

export function listUsersBoundToSession(stateDir: string, projectDir: string, sessionId: string) {
  const sessions = loadSessionMap(stateDir)
  const users: string[] = []
  for (const [userId, state] of Object.entries(sessions)) {
    const agentId = state.activeAgentId?.trim() || DEFAULT_AGENT_ID
    const agent = readRegistryAgentById(projectDir, agentId)
    if (agent?.sessionId === sessionId) users.push(userId)
  }
  return users
}
