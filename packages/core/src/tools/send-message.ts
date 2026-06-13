import { tool, type PluginInput } from "@opencode-ai/plugin"
import { getRegistryStore } from "../registry/context.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"
import { trimRecipientQuery } from "./recipient.ts"

function registryDirectory(recipients: { agentId: string; sessionId: string; displayName: string; profile: string }[]) {
  return recipients.map((item) => ({
    agent_id: item.agentId,
    session_id: item.sessionId,
    display_name: item.displayName,
    profile: item.profile,
  }))
}

export function sendMessageTool(input: PluginInput) {
  return tool({
    description:
      "Send a message to another Gatehouse agent. Does NOT change orchestration state. Use for peer/outer conversation, in-flight alignment, or small course corrections while the peer is still running and has not completed. recipient: outer profile (lead|architect|curator|arbiter), execution-tree node_id, OpenCode session_id, or registry agent_id. Busy recipients queue delivery automatically — no need to resend. Do not use for phase completion — gatehouse_execution_complete. Do not use when orchestration must wait for a correction — gatehouse_execution_rework with a narrow reason.",
    args: {
      recipient: tool.schema
        .string()
        .min(1)
        .describe("Target: lead|architect|curator|arbiter, node_id, session_id, or agent_id"),
      message: tool.schema
        .string()
        .min(1)
        .describe("Conversation or in-flight fix instructions (specific path/lines when correcting work)"),
    },
    async execute(args, context) {
      const toolName = "gatehouse_send_message"
      try {
        const query = trimRecipientQuery(args.recipient)
        if (!query) {
          return {
            output: toolFail(toolName, "MISSING_RECIPIENT", "recipient is required"),
            ...toolMetadata(toolName),
          }
        }
        const store = await getRegistryStore(input)
        const result = await store.sendMessage({
          senderSessionId: context.sessionID,
          senderProfile: context.agent,
          recipientQuery: query,
          message: args.message,
        })

        if (result.status === "not_found") {
          const hint =
            query === "architect" || query === "curator" || query === "arbiter"
              ? "; call gatehouse_init_team from profile lead first"
              : undefined
          return {
            output: toolFail(toolName, "RECIPIENT_NOT_FOUND", `Recipient not found in registry${hint ?? ""}`, {
              recipient: query,
              candidates: registryDirectory(result.candidates),
            }),
            ...toolMetadata(toolName),
          }
        }
        if (result.status === "ambiguous") {
          return {
            output: toolFail(toolName, "RECIPIENT_AMBIGUOUS", "Recipient query matched multiple registry agents", {
              recipient: query,
              candidates: registryDirectory(result.candidates),
            }),
            ...toolMetadata(toolName),
          }
        }
        if (result.status === "self") {
          return {
            output: toolFail(toolName, "SEND_SELF", "Cannot send to your own session"),
            ...toolMetadata(toolName),
          }
        }
        if (result.status === "forbidden") {
          return {
            output: toolFail(toolName, "SEND_FORBIDDEN", result.reason, {
              recipient: query,
              sender_agent_id: result.sender?.agentId,
              recipient_agent_id: result.recipient?.agentId,
            }),
            ...toolMetadata(toolName),
          }
        }
        if (result.status === "failed") {
          return {
            output: toolFail(toolName, "SEND_FAILED", result.error, {
              recipient_agent_id: result.recipient.agentId,
              session_id: result.recipient.sessionId,
            }),
            ...toolMetadata(toolName),
          }
        }

        return {
          output: toolOk(toolName, {
            delivery: result.status,
            recipient_agent_id: result.recipient.agentId,
            recipient_profile: result.recipient.profile,
            session_id: result.sessionId,
            created_session: result.createdSession,
            registry_db: store.dbPath,
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "SEND_ERROR", message), ...toolMetadata(toolName) }
      }
    },
  })
}
