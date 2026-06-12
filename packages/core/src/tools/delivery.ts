import { tool, type PluginInput } from "@opencode-ai/plugin"
import { getRegistryStore } from "../registry/context.ts"
import { isInnerStructuralRoot, LEAD_OPENCODE } from "../registry/types.ts"
import { resolveProjectPath, rootDeliveryRelPath } from "../paths.ts"
import { pendingMissionPublishPaths } from "../delivery/publish-artifacts.ts"
import { readActiveMissionContract } from "../missions/contract.ts"
import { requireLeadCaller } from "../missions/lifecycle.ts"
import { readMissionsDocument } from "../missions/store.ts"
import { requireActiveMissionId } from "../missions/scope.ts"
import {
  deliveryIsFinalized,
  deliveryIsSubmitted,
  readDeliveryDocument,
  reviewDeliveryRecord,
  submitDeliveryRecord,
} from "../delivery/store.ts"
import { formatLeadDeliveryNotification, formatRevisionBriefMessage } from "../delivery/notify.ts"
import type { DeliveryEvidence } from "../delivery/types.ts"
import { notifyWatchdogDeliveryEvent } from "../watchdog/notify.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"

function normalizeReportPath(reportPath: string) {
  return reportPath.replace(/\\/g, "/").replace(/^\.\//, "")
}

function parseEvidenceArray(parsed: unknown): DeliveryEvidence[] {
  if (!Array.isArray(parsed)) throw new Error("evidence must be a JSON array")
  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const record = item as Record<string, unknown>
    const criterion_id = typeof record.criterion_id === "number" ? record.criterion_id : undefined
    const status = typeof record.status === "string" ? record.status : undefined
    if (criterion_id === undefined || !status) return []
    if (!["met", "unmet", "partial", "skipped"].includes(status)) return []
    return [{
      criterion_id,
      status: status as DeliveryEvidence["status"],
      ...(typeof record.proof === "string" && { proof: record.proof }),
    }]
  })
}

/** Accept JSON string or array — agents often pass structured evidence as an object. */
export function parseEvidenceInput(raw: unknown): DeliveryEvidence[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === "string") {
    if (!raw.trim()) return undefined
    return parseEvidenceArray(JSON.parse(raw))
  }
  if (Array.isArray(raw)) return parseEvidenceArray(raw)
  throw new Error("evidence must be a JSON array string or array")
}

export function deliverySubmitTool(input: PluginInput) {
  return tool({
    description:
      "Structural root only: submit mission delivery. Validates root-delivery coordination report, runs done_when precheck, writes .gatehouse/trees/<id>/delivery.yaml (records pending publish: paths), and notifies lead. Portal publish happens when lead calls gatehouse_mission_complete(done). Use force_reason when precheck has unmet items but you still need to submit.",
    args: {
      mission_id: tool.schema.string().optional().describe("Defaults to sender's active mission"),
      report_path: tool.schema
        .string()
        .optional()
        .describe("Default: .gatehouse/trees/<mission_id>/reports/root-delivery.md"),
      summary: tool.schema.string().optional().describe("Short delivery summary for lead"),
      force_reason: tool.schema
        .string()
        .optional()
        .describe("Required when automated precheck has unmet criteria"),
      evidence: tool.schema
        .string()
        .optional()
        .describe(
          'Evidence array as JSON string or structured array: [{"criterion_id":0,"status":"met","proof":"..."}]',
        ),
    },
    async execute(args, context) {
      const toolName = "gatehouse_delivery_submit"
      try {
        const registry = await getRegistryStore(input)
        const sender = registry.bySession(context.sessionID)
        if (!sender || !isInnerStructuralRoot(sender)) {
          return {
            output: toolFail(
              toolName,
              "NOT_STRUCTURAL_ROOT",
              "Only structural root (build-root / build-root-solo) may submit delivery",
            ),
            ...toolMetadata(toolName),
          }
        }
        const missionId = args.mission_id ?? sender.missionId ?? requireActiveMissionId(registry)
        const missionsDoc = await readMissionsDocument(input.directory)
        const mission = missionsDoc.missions.find((entry) => entry.id === missionId)
        if (!mission) {
          return {
            output: toolFail(toolName, "MISSION_NOT_FOUND", `Mission not found in missions.yaml: ${missionId}`),
            ...toolMetadata(toolName),
          }
        }
        if (mission.status !== "running") {
          return {
            output: toolFail(
              toolName,
              "MISSION_NOT_RUNNING",
              `Mission ${missionId} must be running to submit delivery (current: ${mission.status})`,
            ),
            ...toolMetadata(toolName),
          }
        }
        const reportRel = normalizeReportPath(args.report_path ?? rootDeliveryRelPath(missionId))
        if (reportRel !== rootDeliveryRelPath(missionId)) {
          return {
            output: toolFail(toolName, "INVALID_REPORT_PATH", "report_path must be root-delivery.md for this mission", {
              report_path: reportRel,
            }),
            ...toolMetadata(toolName),
          }
        }
        const reportAbs = resolveProjectPath(input.directory, reportRel)
        if (!(await Bun.file(reportAbs).exists())) {
          return {
            output: toolFail(toolName, "REPORT_NOT_FOUND", `Report file missing: ${reportRel}`, {
              expected: reportRel,
            }),
            ...toolMetadata(toolName),
          }
        }
        if (!(await Bun.file(reportAbs).text()).trim()) {
          return {
            output: toolFail(toolName, "REPORT_EMPTY", `Report file is empty: ${reportRel}`),
            ...toolMetadata(toolName),
          }
        }

        let evidence: DeliveryEvidence[] | undefined
        try {
          evidence = parseEvidenceInput(args.evidence)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return { output: toolFail(toolName, "INVALID_EVIDENCE", message), ...toolMetadata(toolName) }
        }

        const submitted = await submitDeliveryRecord({
          projectDirectory: input.directory,
          missionId,
          submittedByNode: sender.nodeId ?? "root",
          reportPath: reportRel,
          summary: args.summary,
          forceReason: args.force_reason,
          evidence,
          missionEntry: mission,
        })
        const pendingPublishPaths = pendingMissionPublishPaths(submitted.record.criteria)
        if (pendingPublishPaths.length > 0) {
          submitted.record.pending_publish_paths = pendingPublishPaths
          const doc = await readDeliveryDocument(input.directory, missionId)
          if (doc?.active) {
            doc.active.pending_publish_paths = pendingPublishPaths
            const { writeDeliveryDocument } = await import("../delivery/store.ts")
            await writeDeliveryDocument(input.directory, doc)
          }
        }

        const contract = readActiveMissionContract(input.directory, missionId)
        const lead = registry.byProfile(LEAD_OPENCODE, "outer")
        if (!lead) {
          return {
            output: toolFail(toolName, "LEAD_NOT_REGISTERED", "Lead not in registry; cannot notify acceptance"),
            ...toolMetadata(toolName),
          }
        }
        const message = formatLeadDeliveryNotification(input.directory, {
          missionId,
          record: submitted.record,
          contract,
          summary: args.summary,
        })
        const notify = await registry.sendMessage({
          senderSessionId: context.sessionID,
          senderProfile: context.agent,
          senderAgentId: sender.agentId,
          recipientQuery: "lead",
          message,
        })
        if (notify.status === "failed") {
          return {
            output: toolFail(toolName, "LEAD_NOTIFY_FAILED", notify.error ?? "failed to notify lead", {
              delivery_version: submitted.record.version,
              record_path: submitted.relPath,
            }),
            ...toolMetadata(toolName),
          }
        }
        notifyWatchdogDeliveryEvent(input.directory, { missionId, kind: "submitted" })
        await registry.flushPendingDeliveries()

        return {
          output: toolOk(toolName, {
            mission_id: missionId,
            delivery_version: submitted.record.version,
            status: submitted.record.status,
            record_path: submitted.relPath,
            report_path: reportRel,
            precheck: submitted.record.precheck,
            pending_publish_paths: pendingPublishPaths,
            lead_delivery: notify.status,
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const code = message.includes("Precheck failed") ? "PRECHECK_FAILED" : "DELIVERY_SUBMIT_FAILED"
        return { output: toolFail(toolName, code, message), ...toolMetadata(toolName) }
      }
    },
  })
}

export function deliveryReviewTool(input: PluginInput) {
  return tool({
    description:
      "profile lead only: request delivery revision or reject a submission. revision_requested clears active delivery, sends revision brief to structural root, and resumes execution watchdog. Publish and acceptance finalize happen on gatehouse_mission_complete(done) after user confirms in chat.",
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
        .describe("Short user comment on reject or revision (stored in delivery.yaml)"),
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
      "Read structured delivery record for a mission (.gatehouse/trees/<id>/delivery.yaml). Allowed for lead, architect, and structural root.",
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
            active: doc.active,
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
