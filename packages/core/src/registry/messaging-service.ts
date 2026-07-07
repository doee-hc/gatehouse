import { enrichLeadDeliveryMessage } from "../messaging/delivery-notify.ts"
import { parseDirectedNotification } from "../i18n.ts"
import { isTerminalInnerAgent } from "../orchestration/plan/graph.ts"
import { readAgentNamesSync, normalizeOuterProfile } from "../names.ts"
import { promptSession } from "../session/client.ts"
import { sessionStatusById } from "../session/status.ts"
import { emitPortalEvent } from "../portal/events.ts"
import { spawnIdForAgent } from "../portal/spawn-id.ts"
import { notifyWatchdogSendMessage } from "../watchdog/notify.ts"
import {
  LEAD_OPENCODE,
  type DeliverSystemNotificationInput,
  type RegistryAgent,
  type SendMessageInput,
  type SendMessageResult,
} from "./types.ts"
import {
  deliveryBackoffMs,
  errorMessage,
  formatDirectedNotification,
  MAX_DELIVERY_ATTEMPTS,
  now,
  pendingEligible,
  pickNodeRecipient,
  sendPolicyViolation,
} from "./helpers.ts"
import type { RecipientResolution, RegistryHost, ResolveOptions } from "./internals.ts"
import { registerOuterSession } from "./agent-registry.ts"
import { syncOuterSessionTitle } from "./session-factory.ts"

export function resolveRecipient(host: RegistryHost, query: string, opts: ResolveOptions = {}): RecipientResolution {
  const trimmed = query.trim()
  const normalized = trimmed.toLowerCase()
  const agents = Array.from(host.state.agents.values()).filter((agent) => {
    if (agent.status !== "active") return false
    if (opts.scope && agent.scope !== opts.scope) return false
    if (
      opts.missionId &&
      (agent.scope === "inner" || agent.scope === "retro") &&
      agent.missionId !== opts.missionId
    ) {
      return false
    }
    return true
  })

  const exactId = agents.find((agent) => agent.agentId === trimmed)
  if (exactId) return { status: "resolved", recipient: exactId, matchedBy: "agentId" }

  const exactSession = agents.find((agent) => agent.sessionId === trimmed)
  if (exactSession) return { status: "resolved", recipient: exactSession, matchedBy: "sessionId" }

  const targetProfile = normalizeOuterProfile(normalized)
  const profileMatches = agents.filter(
    (agent) => agent.scope === "outer" && targetProfile && agent.profile === targetProfile,
  )
  if (profileMatches.length === 1) return { status: "resolved", recipient: profileMatches[0]!, matchedBy: "profile" }

  if (opts.missionId) {
    const nodeMatches = agents.filter((agent) => agent.nodeId === trimmed && agent.missionId === opts.missionId)
    const nodeRecipient = pickNodeRecipient(nodeMatches, opts.sender)
    if (nodeRecipient) return { status: "resolved", recipient: nodeRecipient, matchedBy: "nodeId" }
    if (nodeMatches.length > 1) return { status: "ambiguous", query: trimmed, candidates: nodeMatches }
  }

  if (profileMatches.length > 1) return { status: "ambiguous", query: trimmed, candidates: profileMatches }

  const candidates = agents
    .filter(
      (agent) =>
        agent.agentId.toLowerCase().includes(normalized) ||
        agent.displayName.toLowerCase().includes(normalized) ||
        (agent.scope === "outer" && agent.profile.toLowerCase().includes(normalized)) ||
        agent.nodeId?.toLowerCase().includes(normalized),
    )
    .slice(0, 8)
  return { status: "not_found", query: trimmed, candidates }
}

export async function sendMessage(host: RegistryHost, input: SendMessageInput): Promise<SendMessageResult> {
  if (input.senderProfile === LEAD_OPENCODE && !host.bySession(input.senderSessionId)) {
    const existingLead = host.byProfile("lead", "outer")
    if (!existingLead) {
      registerOuterSession(host, {
        profile: LEAD_OPENCODE,
        sessionId: input.senderSessionId,
        projectRootSessionId: input.senderSessionId,
      })
      await syncOuterSessionTitle(host, input.senderSessionId, "lead")
    }
  }
  const resolvedSender = input.senderAgentId
    ? host.byAgentId(input.senderAgentId)
    : host.bySession(input.senderSessionId)
  if (!resolvedSender) {
    return { status: "forbidden", reason: "Sender session is not registered in registry" }
  }

  if (resolvedSender.scope !== "outer") {
    return {
      status: "forbidden",
      reason: "gatehouse_send_message is outer-team only; execution nodes use gatehouse_execution_complete",
      sender: resolvedSender,
    }
  }

  const missionId = resolvedSender.missionId ?? host.getActiveMission()?.missionId
  const recipientResolution = resolveRecipient(host, input.recipientQuery, {
    missionId,
    sender: resolvedSender,
  })
  if (recipientResolution.status !== "resolved") return recipientResolution

  const recipient = recipientResolution.recipient
  if (recipient.sessionId === input.senderSessionId) return { status: "self", recipient }

  const forbidden = sendPolicyViolation(
    resolvedSender,
    recipient,
    readAgentNamesSync(host.directory),
    host.directory,
  )
  if (forbidden) {
    return {
      status: "forbidden",
      reason: forbidden,
      sender: resolvedSender,
      recipient,
    }
  }

  return deliverDirectedNotification(host, {
    resolvedSender,
    recipient,
    message: input.message,
    senderAgentId: resolvedSender.agentId ?? input.senderAgentId,
    missionId,
  })
}

export async function deliverSystemNotification(
  host: RegistryHost,
  input: DeliverSystemNotificationInput,
): Promise<SendMessageResult> {
  const resolvedSender = input.senderAgentId
    ? host.byAgentId(input.senderAgentId)
    : host.bySession(input.senderSessionId)
  if (!resolvedSender) {
    return { status: "forbidden", reason: "Sender session is not registered in registry" }
  }

  const missionId = resolvedSender.missionId ?? host.getActiveMission()?.missionId
  const recipientResolution = resolveRecipient(host, input.recipientQuery, {
    missionId,
    sender: resolvedSender,
  })
  if (recipientResolution.status !== "resolved") return recipientResolution

  const recipient = recipientResolution.recipient
  if (recipient.sessionId === input.senderSessionId) return { status: "self", recipient }

  if (
    recipient.scope === "outer" &&
    recipient.profile === LEAD_OPENCODE &&
    !isTerminalInnerAgent(host.directory, resolvedSender)
  ) {
    return {
      status: "forbidden",
      reason: "only the terminal node may notify lead of mission delivery",
      sender: resolvedSender,
      recipient,
    }
  }

  return deliverDirectedNotification(host, {
    resolvedSender,
    recipient,
    message: input.message,
    senderAgentId: resolvedSender.agentId ?? input.senderAgentId,
    missionId,
  })
}

async function deliverDirectedNotification(
  host: RegistryHost,
  input: {
    resolvedSender: RegistryAgent
    recipient: RegistryAgent
    message: string
    senderAgentId?: string
    missionId?: string
  },
): Promise<SendMessageResult> {
  const senderLabel = input.resolvedSender.displayName
  const message = enrichLeadDeliveryMessage(host.directory, {
    sender: input.resolvedSender,
    recipient: input.recipient,
    message: input.message,
  })
  const delivery = await deliverToRecipient(host, {
    recipient: input.recipient,
    promptText: formatDirectedNotification(host.directory, senderLabel, message),
    senderAgentId: input.senderAgentId,
  })
  if (delivery.status === "failed") {
    return { status: "failed", recipient: input.recipient, error: delivery.error ?? "prompt failed" }
  }
  notifyWatchdogSendMessage(host.directory, {
    missionId: input.missionId,
    sender: input.resolvedSender,
    recipient: input.recipient,
  })
  return {
    status: delivery.status,
    recipient: input.recipient,
    sessionId: input.recipient.sessionId,
    createdSession: false,
  }
}

function emitPortalAgentChat(sender: RegistryAgent, recipient: RegistryAgent, text: string) {
  emitPortalEvent({
    type: "agent.chat",
    fromSpawnId: spawnIdForAgent(sender),
    toSpawnId: spawnIdForAgent(recipient),
    text,
  })
}

function emitPortalChat(
  host: RegistryHost,
  recipient: RegistryAgent,
  promptText: string,
  options?: { suffix?: string; sender?: RegistryAgent },
) {
  const parsed = parseDirectedNotification(promptText)
  if (!parsed) return
  const sender = options?.sender
  if (!sender) return
  const suffix = options?.suffix ?? ""
  emitPortalAgentChat(sender, recipient, suffix ? `${parsed.text}${suffix}` : parsed.text)
}

export async function deliverSystemMessage(host: RegistryHost, recipient: RegistryAgent, content: string, promptProfile?: string) {
  return deliverToRecipient(host, {
    recipient,
    promptText: formatDirectedNotification(host.directory, "Gatehouse", content),
    promptProfile,
  })
}

export async function deliverSystemPrompt(
  host: RegistryHost,
  recipient: RegistryAgent,
  promptText: string,
  options?: { promptProfile?: string; senderAgentId?: string },
) {
  return deliverToRecipient(host, {
    recipient,
    promptText,
    ...(options?.promptProfile && { promptProfile: options.promptProfile }),
    ...(options?.senderAgentId && { senderAgentId: options.senderAgentId }),
  })
}

async function deliverToRecipient(
  host: RegistryHost,
  input: {
    recipient: RegistryAgent
    promptText: string
    promptProfile?: string
    senderAgentId?: string
  },
) {
  const sender = input.senderAgentId ? host.byAgentId(input.senderAgentId) : undefined
  const portalChat = (suffix?: string) =>
    emitPortalChat(host, input.recipient, input.promptText, { sender, ...(suffix && { suffix }) })
  const busy = await busySessionIds(host)
  if (busy.has(input.recipient.sessionId)) {
    enqueueDelivery(host, {
      recipient: input.recipient,
      senderAgentId: input.senderAgentId,
      promptText: input.promptText,
      promptProfile: input.promptProfile ?? input.recipient.profile,
    })
    portalChat("(queued delivery)")
    return { status: "queued" as const }
  }
  const sent = await sendPrompt(host, input.recipient, input.promptText, input.promptProfile)
  if (sent.status === "failed") return { status: "failed" as const, error: sent.error }
  portalChat()
  return { status: "sent" as const }
}

function enqueueDelivery(
  host: RegistryHost,
  input: {
    recipient: RegistryAgent
    senderAgentId?: string
    promptText: string
    promptProfile?: string
  },
) {
  host.mutate(() => {
    host.state.pendingDeliveries = [
      ...host.state.pendingDeliveries,
      {
        id: crypto.randomUUID(),
        recipientSessionId: input.recipient.sessionId,
        recipientAgentId: input.recipient.agentId,
        promptText: input.promptText,
        createdAt: now(),
        ...(input.senderAgentId && { senderAgentId: input.senderAgentId }),
        ...(input.promptProfile && { promptProfile: input.promptProfile }),
      },
    ]
  })
}

async function sendPrompt(host: RegistryHost, recipient: RegistryAgent, promptText: string, promptProfile?: string) {
  try {
    await promptSession(host.options.client, host.directory, recipient.sessionId, {
      text: promptText,
      profile: promptProfile ?? recipient.profile,
    }, host.options.plugin)
    return { status: "sent" as const }
  } catch (error) {
    return { status: "failed" as const, error: errorMessage(error) }
  }
}

export function flushPendingDeliveries(host: RegistryHost) {
  const run = host.state.flushTail.then(() => flushPendingDeliveriesOnce(host))
  host.state.flushTail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function flushPendingDeliveriesOnce(host: RegistryHost) {
  host.loadSnapshot()
  const nowIso = now()
  const busy = await busySessionIds(host)
  const recipients = [
    ...new Set(
      host.state.pendingDeliveries
        .filter((delivery) => pendingEligible(delivery, nowIso))
        .map((delivery) => delivery.recipientSessionId),
    ),
  ].sort()

  for (const recipientSessionId of recipients) {
    if (busy.has(recipientSessionId)) continue
    await flushRecipientFifo(host, recipientSessionId, nowIso)
  }
}

async function flushRecipientFifo(host: RegistryHost, recipientSessionId: string, nowIso: string) {
  for (;;) {
    host.loadSnapshot()
    const batch = host.state.pendingDeliveries
      .filter(
        (delivery) => delivery.recipientSessionId === recipientSessionId && pendingEligible(delivery, nowIso),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    const next = batch[0]
    if (!next) return

    const recipient = host.byAgentId(next.recipientAgentId)
    if (!recipient) {
      host.mutate(() => {
        host.state.pendingDeliveries = host.state.pendingDeliveries.filter((delivery) => delivery.id !== next.id)
      })
      continue
    }

    const sent = await sendPrompt(host, recipient, next.promptText, next.promptProfile)
    if (sent.status === "sent") {
      const sender = next.senderAgentId ? host.byAgentId(next.senderAgentId) : undefined
      emitPortalChat(host, recipient, next.promptText, { sender })
      host.mutate(() => {
        host.state.pendingDeliveries = host.state.pendingDeliveries.filter((delivery) => delivery.id !== next.id)
      })
      continue
    }

    const attempts = (next.attempts ?? 0) + 1
    if (attempts >= MAX_DELIVERY_ATTEMPTS) {
      host.mutate(() => {
        host.state.pendingDeliveries = host.state.pendingDeliveries.filter((delivery) => delivery.id !== next.id)
      })
      return
    }

    host.mutate(() => {
      host.state.pendingDeliveries = host.state.pendingDeliveries.map((delivery) =>
        delivery.id === next.id
          ? {
              ...delivery,
              attempts,
              lastAttemptAt: nowIso,
              lastError: sent.error,
              nextRetryAt: new Date(Date.now() + deliveryBackoffMs(attempts)).toISOString(),
            }
          : delivery,
      )
    })
    return
  }
}

async function busySessionIds(host: RegistryHost) {
  const map =
    (await sessionStatusById(host.options.client, host.directory, host.options.plugin)) ??
    new Map<string, import("../session/status.ts").SessionRuntimeStatus>()
  return new Set(
    [...map.entries()]
      .filter(([, status]) => status === "busy" || status === "retry")
      .map(([sessionId]) => sessionId),
  )
}
