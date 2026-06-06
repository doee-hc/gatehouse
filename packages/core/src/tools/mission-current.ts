import { tool, type PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { getRegistryStore } from "../registry/context.ts"
import { registryMissionToContract } from "../missions/contract.ts"
import { ARCHITECT_OPENCODE, CURATOR_OPENCODE, LEAD_OPENCODE } from "../registry/types.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"

function canViewMissionCurrent(context: ToolContext) {
  if (context.agent === LEAD_OPENCODE || context.agent === ARCHITECT_OPENCODE || context.agent === CURATOR_OPENCODE) {
    return true
  }
  return false
}

export function missionCurrentTool(input: PluginInput) {
  return tool({
    description:
      "Read the active mission contract from registry.db (frozen at gatehouse_mission_start). Allowed for lead, architect, curator. Returns full objective, done_when, must_not, notes, and metadata. For mission history or queued entries, read .gatehouse/lead/missions.yaml directly.",
    args: {},
    async execute(_args, context) {
      const toolName = "gatehouse_mission_current"
      try {
        const store = await getRegistryStore(input)
        const sender = store.bySession(context.sessionID)
        const allowed =
          canViewMissionCurrent(context) ||
          (sender?.scope === "outer" &&
            (sender.profile === "lead" || sender.profile === "architect" || sender.profile === "curator"))
        if (!allowed) {
          return {
            output: toolFail(toolName, "NOT_AUTHORIZED", "Only lead, architect, or curator may call gatehouse_mission_current"),
            ...toolMetadata(toolName),
          }
        }

        const record = store.getActiveMission()
        if (!record) {
          return {
            output: toolFail(toolName, "NO_ACTIVE_MISSION", "No active mission in registry; lead must call gatehouse_mission_start"),
            ...toolMetadata(toolName),
          }
        }

        return {
          output: toolOk(toolName, registryMissionToContract(record)),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "MISSION_CURRENT_FAILED", message), ...toolMetadata(toolName) }
      }
    },
  })
}
