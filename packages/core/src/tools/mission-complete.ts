import { tool, type PluginInput } from "@opencode-ai/plugin"
import { readMissionsDocument } from "../missions/store.ts"
import {
  abortMissionSessions,
  collectManifestSessionIds,
  deleteMissionSessions,
  finalizeMissionComplete,
  findMission,
  notifyMissionEndedToOuter,
  requireLeadCaller,
  assertRetroReadyForComplete,
  type MissionTerminalStatus,
} from "../missions/lifecycle.ts"
import { ensureMissionContextDumped, ensureMissionPhaseMetricsDumped } from "../session/context-dump.ts"
import type { GatehouseClient } from "../session/client.ts"
import { readManifest, readRetroManifest, readExtractManifest, readVerifyManifest } from "../tree/store.ts"
import { finalizeDeliveryOnMissionComplete } from "../delivery/store.ts"
import { publishAllSkillBlogPosts } from "../delivery/publish-artifacts.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"
import { clearAutopilotWatchState } from "../lead/autopilot-watch.ts"
import { resolveMissionIdArg } from "../missions/scope.ts"

const COMPLETABLE_MISSION_STATUSES = new Set(["queued", "running", "retro"])

export function missionCompleteTool(input: PluginInput) {
  return tool({
    description:
      "profile lead only: end a mission (done or cancelled). On done, pass publish_deliverables=true only when the user confirmed Portal publish. See lead-meta for retro rollup and publish rules.",
    args: {
      mission_id: tool.schema.string().optional().describe("Mission id; default active mission"),
      status: tool.schema
        .enum(["done", "cancelled"])
        .default("done")
        .describe("done = finish without retro or after retro; cancelled = user abort / stop early"),
      user_feedback: tool.schema
        .string()
        .optional()
        .describe("Optional user acceptance comment stored in delivery.yaml when finalizing on done"),
      publish_deliverables: tool.schema
        .boolean()
        .optional()
        .describe(
          "When status=done and user confirmed Portal publish: true publishes accepted path_exists deliverables; omit or false to skip deliverable publish",
        ),
    },
    async execute(args, context) {
      const toolName = "gatehouse_mission_complete"
      try {
        const lead = await requireLeadCaller(input, context)
        if (!lead) {
          return {
            output: toolFail(toolName, "NOT_LEAD", "Only profile lead may call gatehouse_mission_complete"),
            ...toolMetadata(toolName),
          }
        }

        const terminal = args.status as MissionTerminalStatus
        const missionId = resolveMissionIdArg(args.mission_id, lead.registry)
        const doc = await readMissionsDocument(input.directory)
        const mission = findMission(doc, missionId)
        const retroSkipped = mission?.status !== "retro"
        if (!mission) {
          return {
            output: toolFail(toolName, "MISSION_NOT_FOUND", `Mission not found in missions.yaml: ${missionId}`),
            ...toolMetadata(toolName),
          }
        }
        if (mission.status === terminal) {
          return {
            output: toolOk(toolName, {
              mission_id: missionId,
              status: terminal,
              note: "Mission already at target status",
            }),
            ...toolMetadata(toolName),
          }
        }
        if (!COMPLETABLE_MISSION_STATUSES.has(mission.status)) {
          return {
            output: toolFail(
              toolName,
              "MISSION_NOT_ACTIVE",
              `Mission ${missionId} cannot complete from status ${mission.status}`,
            ),
            ...toolMetadata(toolName),
          }
        }

        if (terminal === "done" && mission.status === "retro") {
          try {
            assertRetroReadyForComplete(lead.registry, missionId)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const readiness = lead.registry.retroCompleteReadiness(missionId)
            return {
              output: toolFail(toolName, "RETRO_ROLLUP_PENDING", message, {
                pending: readiness.pending,
              }),
              ...toolMetadata(toolName),
            }
          }
        }

        let delivery_finalize:
          | Awaited<ReturnType<typeof finalizeDeliveryOnMissionComplete>>
          | undefined
        if (terminal === "done") {
          delivery_finalize = await finalizeDeliveryOnMissionComplete({
            projectDirectory: input.directory,
            missionId,
            missionEntry: mission,
            userFeedback: args.user_feedback,
            publishDeliverables: terminal === "done" && args.publish_deliverables === true,
          })
        }

        const manifest = await readManifest(input.directory, missionId)
        const retro = await readRetroManifest(input.directory, missionId)
        const extract = await readExtractManifest(input.directory, missionId)
        const verify = await readVerifyManifest(input.directory, missionId)
        const sessionIds = manifest ? collectManifestSessionIds(manifest, retro, extract, verify) : []

        if (manifest) {
          await ensureMissionContextDumped({
            client: input.client as GatehouseClient,
            projectDirectory: input.directory,
            manifest,
          })
        }
        await ensureMissionPhaseMetricsDumped({
          client: input.client as GatehouseClient,
          projectDirectory: input.directory,
          missionId,
          retro,
          extract,
          verify,
        })
        lead.registry.purgePendingDeliveriesForMission(missionId)
        await abortMissionSessions(input, sessionIds)
        await deleteMissionSessions(input, sessionIds)

        await finalizeMissionComplete({
          projectDirectory: input.directory,
          missionId,
          status: terminal,
          registry: lead.registry,
        })

        const published_skill_posts =
          terminal === "done" ? await publishAllSkillBlogPosts(input.directory) : []

        await notifyMissionEndedToOuter(lead.registry, {
          missionId,
          status: terminal,
          projectDirectory: input.directory,
          retroSkipped,
        })

        await clearAutopilotWatchState(input.directory)

        return {
          output: toolOk(toolName, {
            mission_id: missionId,
            status: terminal,
            ...(delivery_finalize && {
              delivery: delivery_finalize.skipped
                ? { skipped: true, reason: delivery_finalize.reason }
                : {
                    delivery_version: delivery_finalize.delivery_version,
                    published_artifacts: delivery_finalize.published_artifacts,
                    ...(delivery_finalize.publish_warnings?.length && {
                      publish_warnings: delivery_finalize.publish_warnings,
                    }),
                  },
            }),
            ...(published_skill_posts.length > 0 && { skill_posts_published: published_skill_posts.length }),
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "MISSION_COMPLETE_FAILED", message), ...toolMetadata(toolName) }
      }
    },
  })
}
