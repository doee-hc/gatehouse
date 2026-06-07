import { tool, type PluginInput } from "@opencode-ai/plugin"
import { getRegistryStore } from "../registry/context.ts"
import { requireLeadCaller } from "../missions/lifecycle.ts"
import { startMissionFromYaml } from "../missions/start.ts"
import { formatMissionStartedMessage } from "../messaging/delivery-notify.ts"
import { readAgentNamesSync, renderGatehouseTemplate } from "../names.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"

export function missionStartTool(input: PluginInput) {
  return tool({
    description:
      "profile lead only: start a queued mission from .gatehouse/lead/missions.yaml. Validates fields, asserts serial policy, writes frozen snapshot to registry.db (gatehouse_mission_current), sets status running, and auto-notifies architect. Do not hand-edit running status or duplicate the kickoff via send_message.",
    args: {
      mission_id: tool.schema.string().min(1),
    },
    async execute(args, context) {
      const toolName = "gatehouse_mission_start"
      try {
        const lead = await requireLeadCaller(input, context)
        if (!lead) {
          return {
            output: toolFail(toolName, "NOT_LEAD", "Only profile lead may call gatehouse_mission_start"),
            ...toolMetadata(toolName),
          }
        }

        const started = await startMissionFromYaml({
          projectDirectory: input.directory,
          missionId: args.mission_id,
          registry: lead.registry,
        })

        const architect = lead.registry.byProfile("architect", "outer")
        if (!architect) {
          return {
            output: toolFail(
              toolName,
              "ARCHITECT_NOT_REGISTERED",
              "Architect not in registry; call gatehouse_init_team first",
            ),
            ...toolMetadata(toolName),
          }
        }

        const names = readAgentNamesSync(input.directory)
        const message = renderGatehouseTemplate(
          formatMissionStartedMessage(input.directory, {
            missionId: args.mission_id,
            leadName: names.lead,
          }),
          names,
        )
        const delivery = await lead.registry.sendMessage({
          senderSessionId: context.sessionID,
          senderProfile: context.agent,
          recipientQuery: "architect",
          message,
        })
        await lead.registry.flushPendingDeliveries()

        return {
          output: toolOk(toolName, {
            mission_id: args.mission_id,
            status: "running",
            started_at: started.started_at,
            locked_at: started.record.lockedAt,
            architect_delivery: delivery.status,
            ...(delivery.status === "failed" && "error" in delivery && { error: delivery.error }),
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "MISSION_START_FAILED", message), ...toolMetadata(toolName) }
      }
    },
  })
}
