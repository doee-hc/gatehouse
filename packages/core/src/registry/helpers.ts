import { buildDirectedNotification } from "../i18n.ts"
import { readLocaleSync } from "../locale.ts"
import { isTerminalInnerAgent } from "../orchestration/plan/graph.ts"
import type { OuterProfile } from "../names.ts"
import type { RegistryAgent } from "./types.ts"

export const MAX_DELIVERY_ATTEMPTS = 10

export function now() {
  return new Date().toISOString()
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function pendingEligible(
  delivery: { nextRetryAt?: string },
  nowIso: string,
) {
  if (delivery.nextRetryAt && delivery.nextRetryAt > nowIso) return false
  return true
}

export function deliveryBackoffMs(attempts: number) {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1))
}

export function formatDirectedNotification(
  projectDirectory: string,
  senderLabel: string,
  content: string,
) {
  return buildDirectedNotification(senderLabel, content, readLocaleSync(projectDirectory))
}

export function skillExtractCompletionKey(missionId: string, nodeId: string) {
  return `${missionId}:${nodeId}`
}

export function skillVerifyCompletionKey(missionId: string, nodeId: string) {
  return `${missionId}:${nodeId}`
}

export function pickNodeRecipient(matches: RegistryAgent[], sender?: RegistryAgent) {
  if (matches.length === 1) return matches[0]
  if (matches.length < 2) return undefined
  if (sender?.scope === "inner") {
    const inner = matches.filter((agent) => agent.scope === "inner")
    if (inner.length === 1) return inner[0]
  }
  return undefined
}

export function sendPolicyViolation(
  sender: RegistryAgent,
  recipient: RegistryAgent,
  names: Record<OuterProfile, string>,
  projectDirectory: string,
) {
  if (sender.scope !== "outer") {
    return "gatehouse_send_message is outer-team only"
  }
  if (sender.profile === "lead") {
    if (recipient.scope === "outer" && (recipient.profile === "architect" || recipient.profile === "curator")) return undefined
    if (isTerminalInnerAgent(projectDirectory, recipient)) return undefined
    return `profile lead (${names.lead}) may only message architect (${names.architect}), curator (${names.curator}), or the terminal node`
  }
  if (sender.profile === "architect") {
    if (recipient.scope === "outer" && recipient.profile === "lead") return undefined
    return `profile architect (${names.architect}) may only message lead (${names.lead})`
  }
  if (sender.profile === "curator") {
    if (recipient.scope === "outer" && recipient.profile === "lead") return undefined
    if (recipient.scope === "inner") return undefined
    return `profile curator (${names.curator}) may only message lead (${names.lead}) or execution team sessions`
  }
  return "sender is not allowed to use gatehouse_send_message"
}
