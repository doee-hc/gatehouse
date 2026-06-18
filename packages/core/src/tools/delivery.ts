import { tool, type PluginInput } from "@opencode-ai/plugin"
import { resolveTerminalNode } from "../orchestration/plan-graph.ts"
import { RegistryDatabase } from "../registry/db.ts"
import { readActiveMissionContract } from "../missions/contract.ts"
import { requireLeadCaller } from "../missions/lifecycle.ts"
import { resolveMissionIdArg } from "../missions/scope.ts"
import { reviewDeliveryRecord } from "../delivery/store.ts"
import { formatRevisionBriefMessage } from "../delivery/notify.ts"
import { kickoffArchitectDeliveryRevision } from "../orchestration/continuation.ts"
import { notifyWatchdogDeliveryEvent } from "../watchdog/notify.ts"
import { clearAutopilotWatchState } from "../lead/autopilot-watch.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"
import { parseFailedCriteriaInput } from "./helpers.ts"

export function deliveryReviewTool(input: PluginInput) {
  return tool({
    description:
      "profile lead only: request delivery revision or reject for the active mission. revision_requested notifies the orchestration terminal node (or architect when architect_orchestrate=true). Final acceptance on gatehouse_mission_complete(done).",
    args: {
      mission_id: tool.schema.string().optional().describe("Mission id; default active mission"),
      decision: tool.schema.enum(["revision_requested", "rejected"]),
      failed_criteria: tool.schema
        .array(tool.schema.number())
        .optional()
        .describe("Criterion ids that failed; use for revision_requested"),
      user_feedback: tool.schema
        .string()
        .optional()
        .describe("Short user comment on reject or revision (stored in delivery record)"),
      revision_brief: tool.schema
        .string()
        .optional()
        .describe("Structured rework goals; required for revision_requested"),
      architect_orchestrate: tool.schema
        .boolean()
        .optional()
        .describe("When true with revision_requested: kickoff architect to rewrite mission.script.ts and gatehouse_submit_orchestration(mode=continue) instead of notifying the terminal node only"),
    },
    async execute(args, context) {
      const toolName = "gatehouse_delivery_review"
      try {
        const lead = await requireLeadCaller(input, context)
        if (!lead) {
          return {
            output: toolFail(toolName, "NOT_LEAD", "Only profile lead may call gatehouse_delivery_review"),
            ...toolMetadata(toolName),
          }
        }
        const missionId = resolveMissionIdArg(args.mission_id, lead.registry)
        const failedCriteria = parseFailedCriteriaInput(args.failed_criteria)
        const reviewed = await reviewDeliveryRecord({
          projectDirectory: input.directory,
          missionId,
          reviewedBy: "lead",
          decision: args.decision,
          failedCriteria,
          userFeedback: args.user_feedback,
          revisionBrief: args.revision_brief,
        })

        if (reviewed.revision) {
          const previous = reviewed.reviewed
          const contract = readActiveMissionContract(input.directory, missionId)
          const revisionBody = formatRevisionBriefMessage(input.directory, {
            missionId,
            fromVersion: previous.version,
            toVersion: previous.version + 1,
            record: previous,
            revisionBrief: args.revision_brief ?? "",
            failedCriteria: failedCriteria ?? [],
            userFeedback: args.user_feedback,
            mustNot: contract?.must_not ?? [],
          })

          if (args.architect_orchestrate) {
            await kickoffArchitectDeliveryRevision(lead.registry, input.directory, {
              missionId,
              fromVersion: previous.version,
              revisionBody,
            })
            notifyWatchdogDeliveryEvent(input.directory, { missionId, kind: "revision_requested" })
            await clearAutopilotWatchState(input.directory)
            await lead.registry.flushPendingDeliveries()
            return {
              output: toolOk(toolName, {
                mission_id: missionId,
                decision: args.decision,
                next_version: previous.version + 1,
                architect_orchestrate: true,
              }),
              ...toolMetadata(toolName),
            }
          }

          const scriptDb = new RegistryDatabase(input.directory, { readonly: true })
          const terminalId = resolveTerminalNode({
            plan: scriptDb.getLatestOrchestrationPlan(missionId),
          })
          const root = lead.registry
            .list({ scope: "inner", missionId })
            .find((agent) => agent.nodeId === terminalId)
          if (!root) {
            return {
              output: toolFail(toolName, "ROOT_NOT_FOUND", `Terminal node not found for mission ${missionId}`),
              ...toolMetadata(toolName),
            }
          }
          const notify = await lead.registry.sendMessage({
            senderSessionId: context.sessionID,
            senderProfile: context.agent,
            recipientQuery: root.nodeId ?? root.agentId,
            message: revisionBody,
          })
          notifyWatchdogDeliveryEvent(input.directory, { missionId, kind: "revision_requested" })
          await clearAutopilotWatchState(input.directory)
          await lead.registry.flushPendingDeliveries()
          return {
            output: toolOk(toolName, {
              mission_id: missionId,
              decision: args.decision,
              next_version: previous.version + 1,
              root_delivery: notify.status,
            }),
            ...toolMetadata(toolName),
          }
        }

        return {
          output: toolOk(toolName, {
            mission_id: missionId,
            decision: args.decision,
            delivery_version: reviewed.reviewed.version,
            status: reviewed.reviewed.status,
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const code = message.includes("gatehouse_mission_start") ? "NO_ACTIVE_MISSION" : "DELIVERY_REVIEW_FAILED"
        return { output: toolFail(toolName, code, message), ...toolMetadata(toolName) }
      } finally {
        await clearAutopilotWatchState(input.directory).catch(() => undefined)
      }
    },
  })
}
