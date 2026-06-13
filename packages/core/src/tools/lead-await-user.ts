import { tool, type PluginInput } from "@opencode-ai/plugin"
import { requireLeadCaller } from "../missions/lifecycle.ts"
import { armLeadAwaitUser, type LeadAwaitPhase } from "../lead/await-user-state.ts"
import { readMissionsDocument } from "../missions/store.ts"
import { findMission } from "../missions/lifecycle.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"

const PHASES = ["pre_start", "acceptance", "post_retro"] as const

export function leadAwaitUserTool(input: PluginInput) {
  return tool({
    description:
      "profile lead only: arm the user-await watchdog after you asked the user for confirmation. Required for pre_start (mission start confirm). acceptance/post_retro are also monitored automatically once delivery/retro rollup is ready — call this after your confirmation prompt so timing starts from your last assistant message. Do not call during normal mission execution.",
    args: {
      phase: tool.schema.enum(PHASES).describe("Which confirmation gate you are waiting on"),
      mission_id: tool.schema.string().min(1),
    },
    async execute(args, context) {
      const toolName = "gatehouse_lead_await_user"
      try {
        const lead = await requireLeadCaller(input, context)
        if (!lead) {
          return {
            output: toolFail(toolName, "NOT_LEAD", "Only profile lead may call gatehouse_lead_await_user"),
            ...toolMetadata(toolName),
          }
        }

        const doc = await readMissionsDocument(input.directory)
        const mission = findMission(doc, args.mission_id)
        if (!mission) {
          return {
            output: toolFail(toolName, "MISSION_NOT_FOUND", `Mission not found in missions.yaml: ${args.mission_id}`),
            ...toolMetadata(toolName),
          }
        }

        const phase = args.phase as LeadAwaitPhase
        if (phase === "pre_start" && mission.status !== "queued") {
          return {
            output: toolFail(
              toolName,
              "INVALID_PHASE",
              `pre_start requires mission status queued (current: ${mission.status})`,
            ),
            ...toolMetadata(toolName),
          }
        }
        if (phase === "acceptance" && mission.status !== "running") {
          return {
            output: toolFail(
              toolName,
              "INVALID_PHASE",
              `acceptance requires mission status running (current: ${mission.status})`,
            ),
            ...toolMetadata(toolName),
          }
        }
        if (phase === "post_retro" && mission.status !== "retro") {
          return {
            output: toolFail(
              toolName,
              "INVALID_PHASE",
              `post_retro requires mission status retro (current: ${mission.status})`,
            ),
            ...toolMetadata(toolName),
          }
        }

        await armLeadAwaitUser({
          projectDirectory: input.directory,
          phase,
          missionId: args.mission_id,
        })

        return {
          output: toolOk(toolName, {
            phase,
            mission_id: args.mission_id,
            armed: phase === "pre_start",
            note: "User-await watchdog armed; timer starts after your last assistant message when lead session is idle",
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "LEAD_AWAIT_USER_FAILED", message), ...toolMetadata(toolName) }
      }
    },
  })
}
