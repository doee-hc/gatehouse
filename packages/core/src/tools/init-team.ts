import { tool, type PluginInput } from "@opencode-ai/plugin"
import { getRegistryStore } from "../registry/context.ts"
import { LEAD_OPENCODE } from "../registry/types.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"

export function initTeamTool(input: PluginInput) {
  return tool({
    description:
      "profile lead only: create and register architect, curator, and arbiter registry sessions (idempotent). Call before gatehouse_send_message.",
    args: {},
    async execute(_args, context) {
      const toolName = "gatehouse_init_team"
      try {
        if (context.agent !== LEAD_OPENCODE) {
          return {
            output: toolFail(toolName, "FORBIDDEN", "Only profile lead may initialize the outer team"),
            ...toolMetadata(toolName),
          }
        }
        const store = await getRegistryStore(input)
        if (!store.bySession(context.sessionID)) {
          store.registerOuterSession({
            profile: LEAD_OPENCODE,
            sessionId: context.sessionID,
            projectRootSessionId: context.sessionID,
          })
          await store.ensureLeadSystemPrompt(context.sessionID)
        }
        const team = await store.initOuterTeam(context.sessionID)
        return {
          output: toolOk(toolName, { registry_db: store.dbPath, ...team }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "INIT_TEAM_FAILED", message), ...toolMetadata(toolName) }
      }
    },
  })
}
