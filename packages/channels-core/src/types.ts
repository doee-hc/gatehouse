export type ChannelBridgeConfig = {
  projectDir: string
  opencodeUrl: string
  leadReplyTimeoutMs: number
  stateDir: string
}

export type UserChatState = {
  lastMessageId?: number
  lastMessageKey?: string
  recentMessageKeys?: string[]
  /** OpenCode registry agent_id (e.g. outer:lead, inner:mission:node). */
  activeAgentId?: string
  /** Latest iLink context_token from inbound WeChat messages (for proactive outbound). */
  lastContextToken?: string
  /** Per-session watermark: last assistant message id already delivered to this user. */
  lastDeliveredAssistantBySession?: Record<string, string>
}
