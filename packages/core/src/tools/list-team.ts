import { tool, type PluginInput } from "@opencode-ai/plugin"
import { getRegistryStore } from "../registry/context.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"
import { buildListTeamData } from "./list-views.ts"

export function listTeamTool(input: PluginInput) {
  return tool({
    description:
      "List team members visible to your role (no arguments). Outer profiles: full outer roster plus active-mission execution tree and retro nodes when present; arbiter entries include session_id. Inner structural root: lead plus all execution nodes. Other inner: all execution nodes. Retro fork: only your subtree from the execution manifest.",
    args: {},
    async execute(_args, context) {
      const toolName = "gatehouse_list_team"
      try {
        const store = await getRegistryStore(input)
        const result = await buildListTeamData({
          store,
          directory: input.directory,
          callerProfile: context.agent,
          sessionId: context.sessionID,
        })
        if ("error" in result) {
          return {
            output: toolFail(toolName, result.code, result.error),
            ...toolMetadata(toolName),
          }
        }
        return {
          output: toolOk(toolName, result),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "LIST_FAILED", message), ...toolMetadata(toolName) }
      }
    },
  })
}
