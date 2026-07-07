import { tool, type PluginInput } from "@opencode-ai/plugin"
import { getRegistryStore } from "../registry/context.ts"
import type { RegistryAgent } from "../registry/types.ts"
import { isTerminalInnerAgent } from "../orchestration/plan/graph.ts"
import { sessionMessages } from "../session/client.ts"
import {
  clampSnapshotLines,
  DEFAULT_SESSION_SNAPSHOT_LINES,
  MAX_SESSION_SNAPSHOT_LINES,
  snapshotHasRunningTool,
  tailSessionSnapshotLines,
} from "../session/snapshot.ts"
import { sessionRuntimeStatus, sessionStatusById } from "../session/status.ts"
import { readAgentNamesSync } from "../names.ts"
import { gatehouseMessage } from "../i18n.ts"
import { readLocaleSync, type GatehouseLocale } from "../locale.ts"
import { resolveRecipientMissionId } from "../missions/scope.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"
import {
  checkSessionSnapshotPollGuard,
  getSnapshotPollLimitGuidance,
  MAX_CONSECUTIVE_SESSION_SNAPSHOTS,
} from "./session-snapshot-poll-guard.ts"
import { trimRecipientQuery } from "./recipient.ts"

function registryDirectory(recipients: { agentId: string; sessionId: string; displayName: string; profile: string }[]) {
  return recipients.map((item) => ({
    agent_id: item.agentId,
    session_id: item.sessionId,
    display_name: item.displayName,
    profile: item.profile,
  }))
}

function snapshotPolicyViolation(
  sender: RegistryAgent,
  recipient: RegistryAgent,
  names: ReturnType<typeof readAgentNamesSync>,
  projectDirectory: string,
) {
  if (sender.scope === "inner" || sender.scope === "retro") {
    return "execution sessions cannot snapshot other sessions"
  }
  if (sender.scope === "outer" && sender.profile === "lead") {
    if (recipient.scope === "outer" && recipient.profile === "architect") return undefined
    if (isTerminalInnerAgent(projectDirectory, recipient)) return undefined
    return `profile lead (${names.lead}) may only snapshot architect (${names.architect}) or the terminal node`
  }
  if (sender.scope === "outer" && sender.profile === "architect") {
    if (recipient.scope === "outer" && recipient.profile !== "architect") return undefined
    if (recipient.scope === "inner") return undefined
    return `profile architect (${names.architect}) may only snapshot lead (${names.lead}) or same-mission execution sessions`
  }
  if (sender.scope === "outer" && sender.profile === "arbiter") {
    return undefined
  }
  return "sender is not allowed to snapshot this session"
}

function activityHint(input: {
  sessionStatus: ReturnType<typeof sessionRuntimeStatus>
  tailLines: string[]
  pendingDeliveries: number
}) {
  if (input.sessionStatus === "busy" || input.sessionStatus === "retry") return "likely_working"
  if (input.pendingDeliveries > 0) return "likely_working"
  if (snapshotHasRunningTool(input.tailLines)) return "likely_working"
  if (input.sessionStatus === "idle" && input.tailLines.length > 0) return "likely_idle"
  return "unknown"
}

function waitGuidance(hint: ReturnType<typeof activityHint>, locale: GatehouseLocale) {
  if (hint === "likely_working") {
    return gatehouseMessage("sessionSnapshot.wait.likelyWorking", locale)
  }
  if (hint === "likely_idle") {
    return gatehouseMessage("sessionSnapshot.wait.likelyIdle", locale)
  }
  return gatehouseMessage("sessionSnapshot.wait.unknown", locale)
}

export function sessionSnapshotTool(input: PluginInput) {
  return tool({
    description:
      "Read-only diagnostic tail of another agent session. One-off triage only — do not poll while waiting for replies.",
    args: {
      recipient: tool.schema
        .string()
        .min(1)
        .describe("Target: lead|architect|curator|arbiter, node_id, session_id, or agent_id"),
      lines: tool.schema
        .number()
        .optional()
        .describe(`Tail line count (default ${DEFAULT_SESSION_SNAPSHOT_LINES}, max ${MAX_SESSION_SNAPSHOT_LINES})`),
    },
    async execute(args, context) {
      const toolName = "gatehouse_session_snapshot"
      try {
        const query = trimRecipientQuery(args.recipient)
        if (!query) {
          return {
            output: toolFail(toolName, "MISSING_RECIPIENT", "recipient is required"),
            ...toolMetadata(toolName),
          }
        }
        const store = await getRegistryStore(input)
        const sender = store.bySession(context.sessionID)
        if (!sender) {
          return {
            output: toolFail(toolName, "SENDER_NOT_REGISTERED", "Caller session is not registered in registry"),
            ...toolMetadata(toolName),
          }
        }

        const resolution = store.resolveRecipient(query, {
          missionId: resolveRecipientMissionId(store, sender),
          sender,
        })
        if (resolution.status === "not_found") {
          return {
            output: toolFail(toolName, "TARGET_NOT_FOUND", "Target not found in registry", {
              recipient: query,
              candidates: registryDirectory(resolution.candidates),
            }),
            ...toolMetadata(toolName),
          }
        }
        if (resolution.status === "ambiguous") {
          return {
            output: toolFail(toolName, "TARGET_AMBIGUOUS", "Target query matched multiple registry agents", {
              recipient: query,
              candidates: registryDirectory(resolution.candidates),
            }),
            ...toolMetadata(toolName),
          }
        }

        const recipient = resolution.recipient
        if (recipient.sessionId === context.sessionID) {
          return {
            output: toolFail(toolName, "SNAPSHOT_SELF", "Cannot snapshot your own session"),
            ...toolMetadata(toolName),
          }
        }

        const forbidden = snapshotPolicyViolation(sender, recipient, readAgentNamesSync(input.directory), input.directory)
        if (forbidden) {
          return {
            output: toolFail(toolName, "SNAPSHOT_FORBIDDEN", forbidden, {
              recipient: query,
              sender_agent_id: sender.agentId,
              recipient_agent_id: recipient.agentId,
            }),
            ...toolMetadata(toolName),
          }
        }

        const locale = readLocaleSync(input.directory)

        const pollGuard = checkSessionSnapshotPollGuard({
          senderSessionId: context.sessionID,
          messageId: context.messageID,
          recipientSessionId: recipient.sessionId,
          locale,
        })
        if (!pollGuard.allowed) {
          return {
            output: toolFail(
              toolName,
              "SNAPSHOT_POLL_LIMIT",
              getSnapshotPollLimitGuidance(locale),
              {
                recipient: query,
                recipient_session_id: recipient.sessionId,
                consecutive_snapshot_count: pollGuard.consecutiveCount,
                max_consecutive_snapshots: MAX_CONSECUTIVE_SESSION_SNAPSHOTS,
                guidance: pollGuard.guidance,
              },
            ),
            ...toolMetadata(toolName),
          }
        }

        const lineCount = clampSnapshotLines(args.lines)
        const [messages, statusLookup] = await Promise.all([
          sessionMessages(input.client, input.directory, recipient.sessionId),
          sessionStatusById(input.client, input.directory, input),
        ])
        const tail = tailSessionSnapshotLines(messages, lineCount)
        const sessionStatus = sessionRuntimeStatus(statusLookup ?? new Map(), recipient.sessionId)
        const pendingDeliveries = store.pendingDeliveryCountForSession(recipient.sessionId)
        const hint = activityHint({ sessionStatus, tailLines: tail, pendingDeliveries })

        return {
          output: toolOk(toolName, {
            recipient_agent_id: recipient.agentId,
            recipient_profile: recipient.profile,
            session_id: recipient.sessionId,
            session_status: sessionStatus,
            pending_deliveries: pendingDeliveries,
            tail,
            guidance: waitGuidance(hint, locale),
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "SNAPSHOT_FAILED", message), ...toolMetadata(toolName) }
      }
    },
  })
}
