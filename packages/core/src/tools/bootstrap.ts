import { tool, type PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { getRegistryStore } from "../registry/context.ts"
import { resolveProjectPath, teamSpecPath } from "../paths.ts"
import { readTeamSpecFromPath, readManifest } from "../tree/store.ts"
import { validateTeamSpec } from "../tree/parse.ts"
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
      "profile architect only: validate TeamSpec and wake curator for skill_domain assignment (no execution sessions yet). Execution-tree bootstrap runs inside gatehouse_apply_skill_domains — do not call this tool from profile curator. Defaults to the active mission teamspec when teamspec_path is omitted.",
    args: {
      teamspec_path: tool.schema
        .string()
        .optional()
        .describe("Path to teamspec.yaml; default .gatehouse/trees/<active_mission>/teamspec.yaml"),
      objective: tool.schema.string().optional().describe("Optional one-line objective stored in trees-index when tree is created"),
    },
    async execute(args, context) {
      const toolName = "gatehouse_bootstrap_tree"
      try {
        const registry = await getRegistryStore(input)
        const spec = args.teamspec_path
          ? await readTeamSpecFromPath(resolveProjectPath(input.directory, args.teamspec_path))
          : await readTeamSpecFromPath(teamSpecPath(input.directory, requireActiveMissionId(registry)))
        if (!spec) {
          return {
            output: toolFail(toolName, "TEAMSPEC_NOT_FOUND", "Active mission teamspec not found; write teamspec.yaml first"),
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

        const existing = await readManifest(input.directory, spec.mission_id)
        if (existing) {
          return {
            output: toolFail(
              toolName,
              "ALREADY_BOOTSTRAPPED",
              `Mission ${spec.mission_id} already bootstrapped (tree manifest in registry.db)`,
            ),
            ...toolMetadata(toolName),
          }
        }

        const caller = await resolveBootstrapCaller(input, context)
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
              teamspec_path: teamSpecPath(input.directory, spec.mission_id),
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
