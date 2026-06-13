import { tool, type PluginInput } from "@opencode-ai/plugin"
import { requireLeadCaller } from "../missions/lifecycle.ts"
import { readDirectionDocument, directionIsConfirmed } from "../lead/direction.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"

export function directionStatusTool(input: PluginInput) {
  return tool({
    description:
      "profile lead only: read long-term direction status from .gatehouse/lead/direction.yaml. Autonomous watchdog decisions require status confirmed.",
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
        return {
          output: toolOk(toolName, {
            path: ".gatehouse/lead/direction.yaml",
            status: direction.status,
            confirmed: directionIsConfirmed(direction),
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
