import { tool, type PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { getRegistryStore } from "../registry/context.ts"
import { missionScriptRelPath, resolveProjectPath } from "../paths.ts"
import { readManifest } from "../tree/store.ts"
import { resolveTeamSource } from "../orchestration/resolve-team.ts"
import { dryRunMissionScriptSource } from "../orchestration/script-validate.ts"
import { MissionScriptParseError } from "../orchestration/script-parse.ts"
import { notifyArchitectOrchestrationFailure } from "../orchestration/notify.ts"
import { validateTeamSpec } from "../tree/parse.ts"
import { retryOrchestrationForActiveMission } from "../orchestration/retry.ts"
import { runBootstrapTree } from "../tree/bootstrap-run.ts"
import { ARCHITECT_OPENCODE, CURATOR_OPENCODE } from "../registry/types.ts"
import { readActiveMissionContract } from "../missions/contract.ts"
import { readMissionsDocument } from "../missions/store.ts"
import { assertMissionRunning } from "../missions/parse.ts"
import { requireActiveMissionId } from "../missions/scope.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"

export function bootstrapTreeTool(input: PluginInput) {
  return tool({
    description:
      "profile architect only: submit mission.script.ts for the active Mission. Next step is curator skill_domain assignment via gatehouse_apply_skill_domains. Do not call from profile curator. Defaults to the active mission script when mission_script_path is omitted.",
    args: {
      mission_script_path: tool.schema
        .string()
        .optional()
        .describe("Path to mission.script.ts; default .gatehouse/trees/<active_mission>/mission.script.ts"),
      objective: tool.schema.string().optional().describe("Optional one-line objective stored in trees-index when tree is created"),
    },
    async execute(args, context) {
      const toolName = "gatehouse_bootstrap_tree"
      try {
        const registry = await getRegistryStore(input)
        const missionId = requireActiveMissionId(registry)
        let spec
        if (args.mission_script_path) {
          const source = await Bun.file(resolveProjectPath(input.directory, args.mission_script_path)).text()
          const dryRun = dryRunMissionScriptSource(source, missionId)
          if (!dryRun.ok) {
            return {
              output: toolFail(toolName, dryRun.code, dryRun.message),
              ...toolMetadata(toolName),
            }
          }
          spec = dryRun.parsed.team
        } else {
          const resolved = await resolveTeamSource(input.directory, missionId)
          spec = resolved?.spec
        }
        if (!spec) {
          return {
            output: toolFail(
              toolName,
              "MISSION_SCRIPT_NOT_FOUND",
              "Active mission has no mission.script.ts",
            ),
            ...toolMetadata(toolName),
          }
        }

        validateTeamSpec(spec)

        const missionsDoc = await readMissionsDocument(input.directory)
        try {
          assertMissionRunning(missionsDoc, spec.mission_id)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const code = message.includes("not found") ? "MISSION_NOT_FOUND" : "MISSION_NOT_RUNNING"
          return { output: toolFail(toolName, code, message), ...toolMetadata(toolName) }
        }

        const caller = await resolveBootstrapCaller(input, context)
        const existing = await readManifest(input.directory, spec.mission_id)
        if (existing) {
          if (caller === "architect") {
            const retried = await retryOrchestrationForActiveMission(input, registry, spec.mission_id)
            if (retried.status === "retried") {
              return {
                output: toolOk(toolName, {
                  phase: "orchestration_restarted",
                  mission_id: spec.mission_id,
                  mission_script_path: missionScriptRelPath(spec.mission_id),
                  orchestration_runtime: retried.orchestration_runtime,
                }),
                ...toolMetadata(toolName),
              }
            }
            if (retried.status === "error") {
              return {
                output: toolFail(toolName, "ORCHESTRATION_FAILED", retried.message),
                ...toolMetadata(toolName),
              }
            }
          }
          return {
            output: toolFail(
              toolName,
              "ALREADY_BOOTSTRAPPED",
              `Mission ${spec.mission_id} already bootstrapped (tree manifest in registry.db)`,
            ),
            ...toolMetadata(toolName),
          }
        }

        if (caller === "architect") {
          const contract = readActiveMissionContract(input.directory, spec.mission_id)
          const curatorKickoff = await registry.kickoffCuratorSkillAssignment({
            missionId: spec.mission_id,
            objective: args.objective ?? contract?.objective,
            spec,
          })
          await registry.flushPendingDeliveries()
          return {
            output: toolOk(toolName, {
              phase: "awaiting_skill_domains",
              mission_id: spec.mission_id,
              mission_script_path: missionScriptRelPath(spec.mission_id),
              note: "Execution tree not created yet; curator apply_skill_domains will bootstrap and dispatch the structural root",
              curator_skill_assign_kickoff: curatorKickoff,
            }),
            ...toolMetadata(toolName),
          }
        }

        if (caller === "curator") {
          const contract = readActiveMissionContract(input.directory, spec.mission_id)
          const result = await runBootstrapTree(input, spec, {
            objective: args.objective ?? contract?.objective,
          })
          return {
            output: toolOk(toolName, { phase: "bootstrapped", ...result }),
            ...toolMetadata(toolName),
          }
        }

        return {
          output: toolFail(toolName, "NOT_AUTHORIZED", "Only profile architect or curator may call gatehouse_bootstrap_tree"),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (error instanceof MissionScriptParseError || message.startsWith("Orchestration failed for ")) {
          try {
            const registry = await getRegistryStore(input)
            const missionId = requireActiveMissionId(registry)
            await notifyArchitectOrchestrationFailure(registry, input.directory, { missionId, error: message })
          } catch {
            // best-effort notify
          }
        }
        const code = message.includes("gatehouse_mission_start") ? "NO_ACTIVE_MISSION" : "BOOTSTRAP_FAILED"
        return { output: toolFail(toolName, code, message), ...toolMetadata(toolName) }
      }
    },
  })
}

async function resolveBootstrapCaller(input: PluginInput, context: ToolContext) {
  const registry = await getRegistryStore(input)
  const sender = registry.bySession(context.sessionID)
  if (sender?.scope === "outer" && sender.profile === "architect") return "architect"
  if (sender?.scope === "outer" && sender.profile === "curator") return "curator"
  if (context.agent === ARCHITECT_OPENCODE) return "architect"
  if (context.agent === CURATOR_OPENCODE) return "curator"
  return undefined
}
