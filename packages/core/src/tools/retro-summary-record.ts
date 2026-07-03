import { tool, type PluginInput } from "@opencode-ai/plugin"
import { getRegistryStore } from "../registry/context.ts"
import { architectSummaryRelPath, curatorSummaryRelPath, resolveProjectPath } from "../paths.ts"
import { ARCHITECT_OPENCODE, CURATOR_OPENCODE } from "../registry/types.ts"
import { readMissionsDocument } from "../missions/store.ts"
import { requireMission } from "../missions/lifecycle.ts"
import { requireActiveMissionId } from "../missions/scope.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"

function retroSummaryReadinessPayload(missionId: string, registry: Awaited<ReturnType<typeof getRegistryStore>>) {
  const readiness = registry.retroCompleteReadiness(missionId)
  return {
    retro_summary_ready: readiness.ready,
    ...(readiness.pending.length > 0 && { remaining: readiness.pending.length }),
  }
}

export function retroSummaryRecordTool(input: PluginInput) {
  return tool({
    description:
      "profile architect only: register architect retro summary after writing architect-summary.md. When retro summaries are complete (and curator summary if skill domains were assigned), Gatehouse auto-notifies profile lead and publishes architect-summary to Portal under the mission.",
    args: {},
    async execute(_args, context) {
      const toolName = "gatehouse_retro_summary_record"
      try {
        if (context.agent !== ARCHITECT_OPENCODE) {
          return {
            output: toolFail(toolName, "NOT_ARCHITECT", "Only profile architect may call gatehouse_retro_summary_record"),
            ...toolMetadata(toolName),
          }
        }
        const registry = await getRegistryStore(input)
        const sender = registry.bySession(context.sessionID)
        if (!sender || sender.scope !== "outer" || sender.profile !== "architect") {
          return {
            output: toolFail(toolName, "NOT_ARCHITECT", "Caller is not registered profile architect"),
            ...toolMetadata(toolName),
          }
        }

        const missionId = requireActiveMissionId(registry)
        const missionsDoc = await readMissionsDocument(input.directory)
        const mission = requireMission(missionsDoc, missionId)
        if (mission.status !== "retro") {
          return {
            output: toolFail(
              toolName,
              "MISSION_NOT_RETRO",
              `Mission ${missionId} must be in retro status (current: ${mission.status})`,
            ),
            ...toolMetadata(toolName),
          }
        }

        const reportRel = architectSummaryRelPath(missionId)
        const reportAbs = resolveProjectPath(input.directory, reportRel)
        if (!(await Bun.file(reportAbs).exists())) {
          return {
            output: toolFail(toolName, "REPORT_NOT_FOUND", `Report file missing: ${reportRel}`, {
              expected: reportRel,
            }),
            ...toolMetadata(toolName),
          }
        }

        const recorded = await registry.recordArchitectRetroSummary({
          missionId,
          reportPath: reportRel,
        })
        await registry.flushPendingDeliveries()

        return {
          output: toolOk(toolName, {
            mission_id: missionId,
            already_submitted: recorded.alreadySubmitted,
            ...retroSummaryReadinessPayload(missionId, registry),
            ...(recorded.lead_notification && { lead_notified: true }),
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const code = message.includes("active mission") ? "NO_ACTIVE_MISSION" : "RETRO_SUMMARY_RECORD_FAILED"
        return { output: toolFail(toolName, code, message), ...toolMetadata(toolName) }
      }
    },
  })
}

export function skillSummaryRecordTool(input: PluginInput) {
  return tool({
    description:
      "profile curator only: register curator skill summary after writing curator-summary.md. When architect summary is also registered, Gatehouse auto-notifies profile lead.",
    args: {},
    async execute(_args, context) {
      const toolName = "gatehouse_skill_summary_record"
      try {
        if (context.agent !== CURATOR_OPENCODE) {
          return {
            output: toolFail(toolName, "NOT_CURATOR", "Only profile curator may call gatehouse_skill_summary_record"),
            ...toolMetadata(toolName),
          }
        }
        const registry = await getRegistryStore(input)
        const sender = registry.bySession(context.sessionID)
        if (!sender || sender.scope !== "outer" || sender.profile !== "curator") {
          return {
            output: toolFail(toolName, "NOT_CURATOR", "Caller is not registered profile curator"),
            ...toolMetadata(toolName),
          }
        }

        const missionId = requireActiveMissionId(registry)
        const missionsDoc = await readMissionsDocument(input.directory)
        const mission = requireMission(missionsDoc, missionId)
        if (mission.status !== "retro") {
          return {
            output: toolFail(
              toolName,
              "MISSION_NOT_RETRO",
              `Mission ${missionId} must be in retro status (current: ${mission.status})`,
            ),
            ...toolMetadata(toolName),
          }
        }

        const reportRel = curatorSummaryRelPath(missionId)
        const reportAbs = resolveProjectPath(input.directory, reportRel)
        if (!(await Bun.file(reportAbs).exists())) {
          return {
            output: toolFail(toolName, "REPORT_NOT_FOUND", `Report file missing: ${reportRel}`, {
              expected: reportRel,
            }),
            ...toolMetadata(toolName),
          }
        }

        const recorded = await registry.recordCuratorSkillSummary({
          missionId,
          reportPath: reportRel,
        })
        await registry.flushPendingDeliveries()

        return {
          output: toolOk(toolName, {
            mission_id: missionId,
            already_submitted: recorded.alreadySubmitted,
            ...retroSummaryReadinessPayload(missionId, registry),
            ...(recorded.lead_notification && { lead_notified: true }),
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const code = message.includes("active mission") ? "NO_ACTIVE_MISSION" : "SKILL_SUMMARY_RECORD_FAILED"
        return { output: toolFail(toolName, code, message), ...toolMetadata(toolName) }
      }
    },
  })
}
