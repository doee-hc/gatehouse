import type { GatehouseLocale } from "../locale.ts"
import { gatehouseMessage } from "../i18n.ts"

export const MAX_CONSECUTIVE_SESSION_SNAPSHOTS = 3

export function getSnapshotPollLimitGuidance(locale: GatehouseLocale) {
  return gatehouseMessage("sessionSnapshot.pollLimitGuidance", locale)
}

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
  locale: GatehouseLocale
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
      guidance: getSnapshotPollLimitGuidance(input.locale),
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
