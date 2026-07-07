import { tool, type PluginInput } from "@opencode-ai/plugin"
import { retroSessionTitle, retroSummaryRelPath, resolveProjectPath } from "../paths.ts"
import { getRegistryStore } from "../registry/context.ts"
import {
  readMissionManifest,
  readRetroManifest,
  writeRetroManifest,
  writeExtractManifest,
} from "../missions/manifest/store.ts"
import type { MissionRetroManifest } from "../missions/manifest/types.ts"
import type { RegistryStore } from "../registry/store.ts"
import { createExtractManifest } from "../extract/setup.ts"
import { resolveTeamSource } from "../orchestration/script/resolve-team.ts"
import { readLatestOrchestrationPlanRecord } from "../orchestration/plan/store.ts"
import { retroAnalysisNodeOrder } from "../retro/analysis-order.ts"
import { createSession } from "../session/client.ts"
import { RETRO_ANALYST_AGENT } from "../registry/types.ts"
import { dumpMissionContext, dumpPhaseSessionMetrics } from "../session/context-dump.ts"
import type { GatehouseClient } from "../session/client.ts"
import { readMissionsDocument, setMissionStatus } from "../missions/store.ts"
import { requireLeadCaller, requireMission, waitForAllMissionAgentsIdle } from "../missions/lifecycle.ts"
import { requireActiveMissionId, requireSenderMissionId } from "../missions/scope.ts"
import { deliveryIsSubmitted, readDeliveryDocument } from "../delivery/store.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"

function retroAlreadyStartedResponse(
  toolName: string,
  missionId: string,
  retro: MissionRetroManifest,
  registry: RegistryStore,
) {
  const retroStatus = registry.retro.retroStatus(missionId)
  return {
    output: toolOk(toolName, {
      mission_id: missionId,
      retro_session_id: retro.retro_session_id,
      already_started: true,
      ...(retroStatus.status === "ok" && {
        summary_submitted: retroStatus.summarySubmitted,
        architect_review_pending: retroStatus.summarySubmitted && !retroStatus.architectSummarySubmitted,
      }),
    }),
    ...toolMetadata(toolName),
  }
}

export function missionRetroTool(input: PluginInput) {
  return tool({
    description:
      "profile lead only: start mission retro after user confirms delivery in chat. Requires delivery recorded, active mission running, manifest present, and all inner exec sessions idle. Forks one retro-analyst session, dumps context/, creates isolated build-extract sessions for nodes with skill_domain, and kickoffs retro + skill-extract. Sets missions.yaml to retro. Retro reports auto-publish to Portal when registered (retro-summary on gatehouse_retro_record, architect-summary on gatehouse_retro_summary_record).",
    args: {},
    async execute(_args, context) {
      const toolName = "gatehouse_mission_retro"
      let retroStatusCommittedMissionId: string | undefined
      try {
        const lead = await requireLeadCaller(input, context)
        if (!lead) {
          return {
            output: toolFail(toolName, "NOT_LEAD", "Only profile lead may call gatehouse_mission_retro"),
            ...toolMetadata(toolName),
          }
        }

        const missionId = requireActiveMissionId(lead.registry)

        const missionsDoc = await readMissionsDocument(input.directory)
        const mission = requireMission(missionsDoc, missionId)

        const existingRetro = await readRetroManifest(input.directory, missionId)
        if (mission.status === "retro") {
          if (existingRetro) {
            return retroAlreadyStartedResponse(toolName, missionId, existingRetro, lead.registry)
          }
          return {
            output: toolFail(
              toolName,
              "RETRO_MANIFEST_MISSING",
              `Mission ${missionId} is retro but retro manifest is missing`,
            ),
            ...toolMetadata(toolName),
          }
        }

        if (mission.status !== "running") {
          return {
            output: toolFail(
              toolName,
              "MISSION_NOT_RUNNING",
              `Mission ${missionId} must be running to start retro (current: ${mission.status})`,
            ),
            ...toolMetadata(toolName),
          }
        }

        if (existingRetro) {
          await setMissionStatus(input.directory, missionId, "retro")
          lead.registry.syncMissionRegistryStatus(missionId, "retro")
          return retroAlreadyStartedResponse(toolName, missionId, existingRetro, lead.registry)
        }

        const manifest = await readMissionManifest(input.directory, missionId)
        if (!manifest) {
          return {
            output: toolFail(toolName, "MANIFEST_NOT_FOUND", `No manifest for mission ${missionId}`),
            ...toolMetadata(toolName),
          }
        }

        if (manifest.status !== "running") {
          return {
            output: toolFail(
              toolName,
              "MANIFEST_NOT_RUNNING",
              `Manifest for ${missionId} is not running (current: ${manifest.status})`,
            ),
            ...toolMetadata(toolName),
          }
        }

        const deliveryDoc = await readDeliveryDocument(input.directory, missionId)
        if (!deliveryIsSubmitted(deliveryDoc)) {
          return {
            output: toolFail(
              toolName,
              "DELIVERY_NOT_SUBMITTED",
              `Mission ${missionId} delivery must be recorded via the orchestration terminal node gatehouse_execution_complete before retro`,
              deliveryDoc?.active
                ? { delivery_version: deliveryDoc.active.version, status: deliveryDoc.active.status }
                : undefined,
            ),
            ...toolMetadata(toolName),
          }
        }

        await waitForAllMissionAgentsIdle({
          registry: lead.registry,
          client: input.client,
          directory: input.directory,
          plugin: input,
          missionId,
          scopes: ["inner"],
        })

        await setMissionStatus(input.directory, missionId, "retro")
        retroStatusCommittedMissionId = missionId
        const registry = await getRegistryStore(input)
        registry.syncMissionRegistryStatus(missionId, "retro")

        const plan = readLatestOrchestrationPlanRecord(input.directory, missionId)
        const analysisOrder = plan ? retroAnalysisNodeOrder(plan) : Object.keys(manifest.nodes)

        const retroSessionId = await createSession(input.client, input.directory, {
          display_name: retroSessionTitle(missionId),
          profile: RETRO_ANALYST_AGENT,
        })

        const retro = {
          mission_id: manifest.mission_id,
          created_at: new Date().toISOString(),
          retro_session_id: retroSessionId,
          analysis_order: analysisOrder,
        } satisfies MissionRetroManifest

        await writeRetroManifest(input.directory, retro)
        registry.retro.syncRetroFromManifest(retro)
        registry.retro.beginRetroRun(manifest.mission_id)

        await dumpMissionContext({
          client: input.client,
          projectDirectory: input.directory,
          manifest,
          analysisOrder,
        })
        registry.syncInnerFromManifest(manifest)

        const resolved = await resolveTeamSource(input.directory, missionId)
        if (!resolved) {
          return {
            output: toolFail(
              toolName,
              "TEAM_NOT_FOUND",
              `No mission.script.ts for mission ${missionId}`,
            ),
            ...toolMetadata(toolName),
          }
        }

        const extract = await createExtractManifest({
          client: input.client,
          projectDirectory: input.directory,
          manifest,
          spec: resolved.spec,
        })
        await writeExtractManifest(input.directory, extract)
        registry.skillPipeline.syncExtractFromManifest(extract, manifest)

        await Promise.all([
          registry.retro.kickoffRetroSession(manifest, plan),
          registry.skillPipeline.kickoffExtractSkillSessions(extract),
        ])
        await registry.flushPendingDeliveries()

        return {
          output: toolOk(toolName, {
            mission_id: manifest.mission_id,
            retro_session_id: retroSessionId,
            analysis_order: analysisOrder,
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const code = message.includes("gatehouse_mission_start") ? "NO_ACTIVE_MISSION" : "MISSION_RETRO_FAILED"
        if (retroStatusCommittedMissionId) {
          try {
            const retroWritten = await readRetroManifest(input.directory, retroStatusCommittedMissionId)
            if (!retroWritten) {
              await setMissionStatus(input.directory, retroStatusCommittedMissionId, "running")
              const registry = await getRegistryStore(input)
              registry.syncMissionRegistryStatus(retroStatusCommittedMissionId, "running")
            }
          } catch {
            // Best-effort rollback when retro failed before manifest was written.
          }
        }
        return { output: toolFail(toolName, code, message), ...toolMetadata(toolName) }
      }
    },
  })
}

export function retroRecordTool(input: PluginInput) {
  return tool({
    description:
      "retro-analyst only: register retro-summary.md after mission analysis. Gatehouse auto-messages profile architect to review and iterate architect-meta, and publishes retro-summary to Portal under the mission.",
    args: {},
    async execute(_args, context) {
      const toolName = "gatehouse_retro_record"
      try {
        if (context.agent !== RETRO_ANALYST_AGENT) {
          return {
            output: toolFail(toolName, "NOT_RETRO_ANALYST", "Only profile retro-analyst may call gatehouse_retro_record"),
            ...toolMetadata(toolName),
          }
        }
        const registry = await getRegistryStore(input)
        const sender = registry.bySession(context.sessionID)
        if (!sender || sender.scope !== "retro") {
          return {
            output: toolFail(toolName, "NOT_RETRO_SESSION", "Only retro sessions may call gatehouse_retro_record"),
            ...toolMetadata(toolName),
          }
        }
        const missionId = requireSenderMissionId(sender)
        const retroRun = registry.retro.retroStatus(missionId)
        if (retroRun.status !== "ok") {
          return {
            output: toolFail(toolName, "NO_RETRO_RUN", `No active retro run for mission ${missionId}`),
          }
        }
        if (retroRun.summarySubmitted) {
          return {
            output: toolOk(toolName, {
              mission_id: missionId,
              already_submitted: true,
              architect_notified: retroRun.architectNotified,
            }),
            ...toolMetadata(toolName),
          }
        }

        const reportRel = retroSummaryRelPath(missionId)
        const reportAbs = resolveProjectPath(input.directory, reportRel)
        if (!(await Bun.file(reportAbs).exists())) {
          return {
            output: toolFail(toolName, "REPORT_NOT_FOUND", `Report file missing: ${reportRel}`, {
              expected: reportRel,
            }),
            ...toolMetadata(toolName),
          }
        }

        await registry.retro.recordRetroSummary({
          missionId,
          sessionId: context.sessionID,
          reportPath: reportRel,
        })
        await dumpPhaseSessionMetrics({
          client: input.client as GatehouseClient,
          projectDirectory: input.directory,
          missionId,
          phase: "retro",
          nodeId: "retro-analyst",
          sessionId: context.sessionID,
        }).catch(() => undefined)

        const status = registry.retro.retroStatus(missionId)
        return {
          output: toolOk(toolName, {
            mission_id: missionId,
            report_path: reportRel,
            ...(status.status === "ok" && {
              architect_notified: status.architectNotified,
            }),
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "RETRO_RECORD_FAILED", message), ...toolMetadata(toolName) }
      }
    },
  })
}
