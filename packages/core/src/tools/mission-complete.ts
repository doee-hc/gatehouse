import { tool, type PluginInput } from "@opencode-ai/plugin"
import { readMissionsDocument } from "../missions/store.ts"
import {
  abortMissionSessions,
  collectManifestSessionIds,
  finalizeMissionComplete,
  findMission,
  notifyMissionEndedToOuter,
  requireLeadCaller,
  type MissionTerminalStatus,
} from "../missions/lifecycle.ts"
import { readManifest, readRetroManifest } from "../tree/store.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"

const COMPLETABLE_MISSION_STATUSES = new Set(["queued", "running", "retro"])

export function missionCompleteTool(input: PluginInput) {
  return tool({
    description:
      "profile lead only: end a mission (done or cancelled). Aborts all execution-tree and retro OpenCode sessions, archives manifest, deactivates inner/retro registry agents, updates missions.yaml, and auto-notifies outer architect and curator (not arbiter). Use instead of hand-editing cancelled/done or send_message to stop the team.",
    args: {
      mission_id: tool.schema.string().min(1),
      status: tool.schema
        .enum(["done", "cancelled"])
        .default("done")
        .describe("done = finish without retro or after retro; cancelled = user abort / stop early"),
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
        const doc = await readMissionsDocument(input.directory)
        const mission = findMission(doc, args.mission_id)
        if (!mission) {
          return {
            output: toolFail(toolName, "MISSION_NOT_FOUND", `Mission not found in missions.yaml: ${args.mission_id}`),
            ...toolMetadata(toolName),
          }
        }
        if (mission.status === terminal) {
          return {
            output: toolOk(toolName, {
              mission_id: args.mission_id,
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
              `Mission ${args.mission_id} cannot complete from status ${mission.status}`,
            ),
            ...toolMetadata(toolName),
          }
        }

        const manifest = await readManifest(input.directory, args.mission_id)
        const retro = await readRetroManifest(input.directory, args.mission_id)
        const sessionIds = manifest ? collectManifestSessionIds(manifest, retro) : []

        lead.registry.purgePendingDeliveriesForMission(args.mission_id)
        const aborts = await abortMissionSessions(input, sessionIds)

        const finalized = await finalizeMissionComplete({
          projectDirectory: input.directory,
          missionId: args.mission_id,
          status: terminal,
          registry: lead.registry,
        })

        const outer_notifications = await notifyMissionEndedToOuter(lead.registry, {
          missionId: args.mission_id,
          status: terminal,
          projectDirectory: input.directory,
        })

        return {
          output: toolOk(toolName, {
            mission_id: args.mission_id,
            status: terminal,
            sessions_aborted: aborts,
            outer_notifications,
            manifest_archived: Boolean(finalized.manifest),
            had_retro_manifest: Boolean(finalized.retro),
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
