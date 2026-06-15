import { tool, type PluginInput } from "@opencode-ai/plugin"
import { requireLeadCaller } from "../missions/lifecycle.ts"
import { readDirectionDocument, directionIsConfirmed } from "../lead/direction.ts"
import { readAutopilotDocument, autopilotIsEnabled } from "../lead/autopilot.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"

export function directionStatusTool(input: PluginInput) {
  return tool({
    description:
      "profile lead only: read direction.yaml and whether autopilot is enabled.",
    args: {},
    async execute(_args, context) {
      const toolName = "gatehouse_direction_status"
      try {
        const lead = await requireLeadCaller(input, context)
        if (!lead) {
          return {
            output: toolFail(toolName, "NOT_LEAD", "Only profile lead may call gatehouse_direction_status"),
            ...toolMetadata(toolName),
          }
        }

        const direction = await readDirectionDocument(input.directory)
        const autopilot = await readAutopilotDocument(input.directory)
        return {
          output: toolOk(toolName, {
            status: direction.status,
            confirmed: directionIsConfirmed(direction),
            autopilot_enabled: autopilotIsEnabled(autopilot),
            summary: direction.summary ?? "",
            constraints: direction.constraints,
            confirmed_at: direction.confirmed_at,
            confirmed_by: direction.confirmed_by,
            review_after: direction.review_after,
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "DIRECTION_STATUS_FAILED", message), ...toolMetadata(toolName) }
      }
    },
  })
}
