export type InspectorReply = "once" | "always" | "reject"

export type PermissionCase = {
  requestId: string
  sessionId: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
  directory?: string
  tool?: {
    messageID: string
    callID: string
  }
  askedAt: string
}

export type InspectorDecisionRecord = {
  requestId: string
  sessionId: string
  permission: string
  reply: InspectorReply
  reason: string
  arbiterSessionId: string
  decidedAt: string
}
