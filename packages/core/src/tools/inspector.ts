import { tool, type PluginInput } from "@opencode-ai/plugin"
import { getPermissionArbiter } from "../arbiter/arbiter.ts"
import { getRegistryStore } from "../registry/context.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"
import { slimInspectorRequester } from "./helpers.ts"

export function inspectorQueueTool(input: PluginInput) {
  return tool({
    description: "List pending permission cases awaiting profile arbiter decision.",
    args: {},
    async execute(_args, context) {
      const toolName = "gatehouse_inspector_queue"
      try {
        const registry = await getRegistryStore(input)
        const arbiter = await getPermissionArbiter(input, registry)
        if (!arbiter.isArbiterSession(context.sessionID)) {
          return {
            output: toolFail(toolName, "FORBIDDEN", "Only profile arbiter may read the permission queue"),
            ...toolMetadata(toolName),
          }
        }
        const pending = await arbiter.listQueueWithStatus()
        return {
          output: toolOk(toolName, {
            pending: pending.map((item) => ({
              request_id: item.requestId,
              session_id: item.sessionId,
              permission: item.permission,
              patterns: item.patterns,
              metadata: item.metadata,
              asked_at: item.askedAt,
              opencode_pending: item.opencode_pending,
              requester: slimInspectorRequester(registry.bySession(item.sessionId)),
            })),
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "QUEUE_FAILED", message), ...toolMetadata(toolName) }
      }
    },
  })
}

export function inspectorDecideTool(input: PluginInput) {
  return tool({
    description: "Submit a permission decision for a pending case (once / always / reject).",
    args: {
      request_id: tool.schema.string().describe("Pending permission request id"),
      reply: tool.schema.enum(["once", "always", "reject"]).describe("Decision"),
      reason: tool.schema.string().describe("Short audit reason for the decision"),
    },
    async execute(args, context) {
      const toolName = "gatehouse_inspector_decide"
      try {
        const registry = await getRegistryStore(input)
        const arbiter = await getPermissionArbiter(input, registry)
        if (!arbiter.isArbiterSession(context.sessionID)) {
          return {
            output: toolFail(toolName, "FORBIDDEN", "Only profile arbiter may decide permissions"),
            ...toolMetadata(toolName),
          }
        }
        await arbiter.applyDecision({
          arbiterSessionId: context.sessionID,
          requestId: args.request_id,
          reply: args.reply,
          reason: args.reason.trim(),
          toolDirectory: context.directory,
        })
        return {
          output: toolOk(toolName, { decided: true }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "DECIDE_FAILED", message), ...toolMetadata(toolName) }
      }
    },
  })
}
