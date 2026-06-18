import { tool, type PluginInput } from "@opencode-ai/plugin"
import { resolveMissionInfo } from "../missions/info.ts"
import { getRegistryStore } from "../registry/context.ts"
import type { RegistryAgent } from "../registry/types.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"

function resolveMissionId(
  sender: RegistryAgent | undefined,
  store: Awaited<ReturnType<typeof getRegistryStore>>,
  missionIdArg?: string,
) {
  return missionIdArg ?? sender?.missionId ?? store.getActiveMission()?.missionId
}

export function missionInfoTool(input: PluginInput) {
  return tool({
    description:
      "Re-read mission scope for your role: shared boundaries, frozen contract, and your node brief when applicable. Returns only what your role may see.",
    args: {
      mission_id: tool.schema.string().optional().describe("Mission id; default active mission"),
    },
    async execute(args, context) {
      const toolName = "gatehouse_mission_info"
      try {
        const store = await getRegistryStore(input)
        const sender = store.bySession(context.sessionID)
        const missionId = resolveMissionId(sender, store, args.mission_id)
        if (!missionId) {
          return { output: toolFail(toolName, "NO_MISSION", "No mission_id"), ...toolMetadata(toolName) }
        }

        const result = await resolveMissionInfo({
          projectDirectory: input.directory,
          sender,
          missionId,
        })

        if ("error" in result) {
          if (result.error === "NOT_AUTHORIZED") {
            return {
              output: toolFail(toolName, "NOT_AUTHORIZED", "Caller may not read gatehouse_mission_info"),
              ...toolMetadata(toolName),
            }
          }
          return {
            output: toolFail(toolName, "NO_CONTRACT", `No registry mission ${missionId}`),
            ...toolMetadata(toolName),
          }
        }

        return { output: toolOk(toolName, result), ...toolMetadata(toolName) }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "MISSION_INFO_FAILED", message), ...toolMetadata(toolName) }
      }
    },
  })
}
