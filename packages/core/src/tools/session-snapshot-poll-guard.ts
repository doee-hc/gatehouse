export const MAX_CONSECUTIVE_SESSION_SNAPSHOTS = 3

export const SNAPSHOT_POLL_LIMIT_GUIDANCE =
  "你已连续对同一目标调用 gatehouse_session_snapshot 超过 3 次。请勿重复轮询对方 session；请立即结束本轮对话，等待系统消息（如 send_message 回报或看门狗通知）后再继续。"

type SnapshotPollState = {
  messageId: string
  lastRecipientSessionId: string | null
  consecutiveCount: number
}

const pollStateBySenderSession = new Map<string, SnapshotPollState>()

export type SnapshotPollGuardResult =
  | { allowed: true; consecutiveCount: number }
  | { allowed: false; consecutiveCount: number; guidance: string }

export function checkSessionSnapshotPollGuard(input: {
  senderSessionId: string
  messageId: string
  recipientSessionId: string
}): SnapshotPollGuardResult {
  const existing = pollStateBySenderSession.get(input.senderSessionId)
  const sameTurn = existing?.messageId === input.messageId
  const sameRecipient =
    sameTurn && existing?.lastRecipientSessionId === input.recipientSessionId

  if (!sameTurn) {
    pollStateBySenderSession.set(input.senderSessionId, {
      messageId: input.messageId,
      lastRecipientSessionId: input.recipientSessionId,
      consecutiveCount: 1,
    })
    return { allowed: true, consecutiveCount: 1 }
  }

  const nextCount = sameRecipient ? existing.consecutiveCount + 1 : 1
  if (sameRecipient && nextCount > MAX_CONSECUTIVE_SESSION_SNAPSHOTS) {
    return {
      allowed: false,
      consecutiveCount: nextCount,
      guidance: SNAPSHOT_POLL_LIMIT_GUIDANCE,
    }
  }

  pollStateBySenderSession.set(input.senderSessionId, {
    messageId: input.messageId,
    lastRecipientSessionId: input.recipientSessionId,
    consecutiveCount: nextCount,
  })
  return { allowed: true, consecutiveCount: nextCount }
}

export function resetSessionSnapshotPollGuardForTests() {
  pollStateBySenderSession.clear()
}
