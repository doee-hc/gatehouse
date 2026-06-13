import { tool, type PluginInput } from "@opencode-ai/plugin"
import { getRegistryStore } from "../registry/context.ts"
import { isInnerStructuralRoot, LEAD_OPENCODE } from "../registry/types.ts"
import { readActiveMissionContract } from "../missions/contract.ts"
import { requireLeadCaller } from "../missions/lifecycle.ts"
import {
  deliveryIsFinalized,
  deliveryIsSubmitted,
  readDeliveryDocument,
  reviewDeliveryRecord,
} from "../delivery/store.ts"
import { pendingMissionPublishPaths } from "../delivery/publish-artifacts.ts"
import { formatRevisionBriefMessage } from "../delivery/notify.ts"
import type { DeliveryRecord } from "../delivery/types.ts"
import { notifyWatchdogDeliveryEvent } from "../watchdog/notify.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"

function enrichActiveRecord(active: DeliveryRecord) {
  return {
    ...active,
    pending_publish_paths: pendingMissionPublishPaths(active.criteria),
  }
}

export function deliveryReviewTool(input: PluginInput) {
  return tool({
    description:
      "profile lead only: request delivery revision or reject a submission. revision_requested clears active delivery, sends revision brief to structural root, and resumes execution. Publish and acceptance finalize happen on gatehouse_mission_complete(done) after user confirms in chat.",
    args: {
      mission_id: tool.schema.string().min(1),
      decision: tool.schema.enum(["revision_requested", "rejected"]),
      failed_criteria: tool.schema
        .string()
        .optional()
        .describe("Comma-separated criterion ids; required for revision_requested"),
      user_feedback: tool.schema
        .string()
        .optional()
        .describe("Short user comment on reject or revision (stored in delivery record)"),
      revision_brief: tool.schema
        .string()
        .optional()
        .describe("Structured rework goals; required for revision_requested"),
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
        const failedCriteria = args.failed_criteria
          ? args.failed_criteria
              .split(",")
              .map((item) => Number.parseInt(item.trim(), 10))
              .filter((item) => !Number.isNaN(item))
          : undefined
        const reviewed = await reviewDeliveryRecord({
          projectDirectory: input.directory,
          missionId: args.mission_id,
          reviewedBy: "lead",
          decision: args.decision,
          failedCriteria,
          userFeedback: args.user_feedback,
          revisionBrief: args.revision_brief,
        })

        if (reviewed.revision) {
          const previous = reviewed.reviewed
          const root = lead.registry.list({ scope: "inner", missionId: args.mission_id }).find((agent) =>
            isInnerStructuralRoot(agent),
          )
          if (!root) {
            return {
              output: toolFail(toolName, "ROOT_NOT_FOUND", `Structural root not found for mission ${args.mission_id}`),
              ...toolMetadata(toolName),
            }
          }
          const contract = readActiveMissionContract(input.directory, args.mission_id)
          const revisionBody = formatRevisionBriefMessage(input.directory, {
            missionId: args.mission_id,
            fromVersion: previous.version,
            toVersion: previous.version + 1,
            record: previous,
            revisionBrief: args.revision_brief ?? "",
            failedCriteria: failedCriteria ?? [],
            userFeedback: args.user_feedback,
            mustNot: contract?.must_not ?? [],
          })
          const notify = await lead.registry.sendMessage({
            senderSessionId: context.sessionID,
            senderProfile: context.agent,
            recipientQuery: root.nodeId ?? root.agentId,
            message: revisionBody,
          })
          notifyWatchdogDeliveryEvent(input.directory, { missionId: args.mission_id, kind: "revision_requested" })
          await lead.registry.flushPendingDeliveries()
          return {
            output: toolOk(toolName, {
              mission_id: args.mission_id,
              decision: args.decision,
              superseded_version: previous.version,
              next_version: previous.version + 1,
              root_delivery: notify.status,
            }),
            ...toolMetadata(toolName),
          }
        }

        return {
          output: toolOk(toolName, {
            mission_id: args.mission_id,
            decision: args.decision,
            delivery_version: reviewed.reviewed.version,
            status: reviewed.reviewed.status,
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "DELIVERY_REVIEW_FAILED", message), ...toolMetadata(toolName) }
      }
    },
  })
}

export function deliveryStatusTool(input: PluginInput) {
  return tool({
    description:
      "Read structured delivery record for a mission. Allowed for lead, architect, and structural root.",
    args: {
      mission_id: tool.schema.string().min(1),
    },
    async execute(args, context) {
      const toolName = "gatehouse_delivery_status"
      try {
        const registry = await getRegistryStore(input)
        const sender = registry.bySession(context.sessionID)
        const allowed =
          sender?.profile === LEAD_OPENCODE ||
          sender?.profile === "architect" ||
          (sender && isInnerStructuralRoot(sender))
        if (!allowed) {
          return {
            output: toolFail(toolName, "NOT_AUTHORIZED", "Only lead, architect, or structural root may read delivery status"),
            ...toolMetadata(toolName),
          }
        }
        const doc = await readDeliveryDocument(input.directory, args.mission_id)
        if (!doc) {
          return {
            output: toolOk(toolName, {
              mission_id: args.mission_id,
              status: "no_delivery",
            }),
            ...toolMetadata(toolName),
          }
        }
        return {
          output: toolOk(toolName, {
            mission_id: args.mission_id,
            finalized: deliveryIsFinalized(doc),
            submitted: deliveryIsSubmitted(doc),
            active: doc.active ? enrichActiveRecord(doc.active) : undefined,
            history_count: doc.history.length,
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "DELIVERY_STATUS_FAILED", message), ...toolMetadata(toolName) }
      }
    },
  })
}
