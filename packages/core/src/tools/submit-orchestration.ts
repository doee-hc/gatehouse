import { tool, type PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { getRegistryStore } from "../registry/context.ts"
import { readMissionManifest } from "../missions/manifest/store.ts"
import { resolveTeamSource } from "../orchestration/script/resolve-team.ts"
import { validateMissionTeamSpec } from "../missions/manifest/team-spec.ts"
import { resumeOrchestrationForActiveMission } from "../orchestration/lifecycle/resume.ts"
import { continueOrchestrationWithNewScript } from "../orchestration/lifecycle/continuation.ts"
import { isSandboxRunning } from "../orchestration/sandbox/runtime.ts"
import { orchestrationAllDone, readOrchestrationState } from "../orchestration/state/store.ts"
import { loadMissionScript } from "../orchestration/script/load.ts"
import { MissionScriptParseError } from "../orchestration/script/parse.ts"
import { missionScriptErrorHint } from "../orchestration/script/error-hints.ts"
import { bootstrapMission } from "../missions/bootstrap.ts"
import { readSkillDomainsRegistry } from "../skills/domains.ts"
import {
  applySkillDomainAssignments,
  resolveSkillDomainAssignments,
} from "../skills/resolve-assignments.ts"
import { orchestrationSandboxHealthy } from "../orchestration/state/guards.ts"
import { ARCHITECT_OPENCODE } from "../registry/types.ts"
import { readActiveMissionContract } from "../missions/contract.ts"
import { readMissionsDocument } from "../missions/store.ts"
import { assertMissionRunning } from "../missions/parse.ts"
import { requireActiveMissionId } from "../missions/scope.ts"
import { toolFail, toolErrorMetadata, toolMetadata, toolOk } from "./envelope.ts"

export function submitOrchestrationTool(input: PluginInput) {
  return tool({
    description:
      "profile architect only: validate and submit mission.script.ts for orchestration. Use mode=continue after rewriting mid-mission. Starts execution immediately; auto-applies skill_domain only when every eligible node maps to an existing domains.yaml entry (otherwise curator assigns after retro).",
    args: {
      mode: tool.schema
        .enum(["submit", "continue"])
        .optional()
        .describe("submit (default): first-time submit or resume same script. continue: apply rewritten script from baseline (reuses done nodes + sessions)."),
    },
    async execute(args, context) {
      const toolName = "gatehouse_submit_orchestration"
      try {
        const registry = await getRegistryStore(input)
        const missionId = requireActiveMissionId(registry)
        const resolved = await resolveTeamSource(input.directory, missionId)
        const spec = resolved?.spec
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

        validateMissionTeamSpec(spec)

        const missionsDoc = await readMissionsDocument(input.directory)
        try {
          assertMissionRunning(missionsDoc, spec.mission_id)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const code = message.includes("not found") ? "MISSION_NOT_FOUND" : "MISSION_NOT_RUNNING"
          return { output: toolFail(toolName, code, message), ...toolMetadata(toolName) }
        }

        const caller = await resolveSubmitOrchestrationCaller(input, context)
        const existing = await readMissionManifest(input.directory, spec.mission_id)
        const submitMode = args.mode ?? "submit"
        if (existing) {
          if (caller === "architect") {
            const script = await loadMissionScript(input.directory, spec.mission_id)
            if (!script) {
              return {
                output: toolFail(toolName, "MISSION_SCRIPT_NOT_FOUND", "Active mission has no mission.script.ts"),
                ...toolMetadata(toolName),
              }
            }

            if (submitMode === "continue") {
              const state = readOrchestrationState(input.directory, spec.mission_id)
              if (state && orchestrationSandboxHealthy(state, isSandboxRunning(spec.mission_id))) {
                return {
                  output: toolOk(toolName, {
                    phase: "orchestration_running",
                    mission_id: spec.mission_id,
                  }),
                  ...toolMetadata(toolName),
                }
              }
              const continued = await continueOrchestrationWithNewScript(input, registry, spec.mission_id)
              if (continued.status === "continued") {
                await registry.flushPendingDeliveries()
                return {
                  output: toolOk(toolName, {
                    phase: "orchestration_continued",
                    mission_id: spec.mission_id,
                    ...(script.plan?.warnings.length && { plan_warnings: script.plan.warnings }),
                  }),
                  ...toolMetadata(toolName),
                }
              }
              if (continued.status === "error") {
                return {
                  output: toolFail(toolName, "ORCHESTRATION_FAILED", continued.message),
                  ...toolMetadata(toolName),
                }
              }
              return {
                output: toolFail(toolName, "NOT_CONTINUABLE", continued.reason),
                ...toolMetadata(toolName),
              }
            }

            const resumed = await resumeOrchestrationForActiveMission(input, registry, spec.mission_id)
            if (resumed.status === "resumed") {
              return {
                output: toolOk(toolName, {
                  phase: "orchestration_resumed",
                  mission_id: spec.mission_id,
                }),
                ...toolMetadata(toolName),
              }
            }
            if (resumed.status === "error") {
              const hint = resumed.message.includes("plan changed") || resumed.message.includes("script.ts changed")
                ? " Rewrite mission.script.ts and call gatehouse_submit_orchestration(mode=continue)."
                : ""
              return {
                output: toolFail(toolName, "ORCHESTRATION_FAILED", `${resumed.message}${hint}`),
                ...toolMetadata(toolName),
              }
            }
            if (isSandboxRunning(spec.mission_id)) {
              return {
                output: toolOk(toolName, {
                  phase: "orchestration_running",
                  mission_id: spec.mission_id,
                }),
                ...toolMetadata(toolName),
              }
            }
            const state = readOrchestrationState(input.directory, spec.mission_id)
            if (state && orchestrationAllDone(state)) {
              return {
                output: toolFail(
                  toolName,
                  "ORCHESTRATION_ALREADY_STARTED",
                  `Mission ${spec.mission_id} orchestration is complete`,
                ),
                ...toolMetadata(toolName),
              }
            }
          }
          return {
            output: toolFail(
              toolName,
              "ORCHESTRATION_ALREADY_STARTED",
              `Mission ${spec.mission_id} already has an mission manifest in registry.db`,
            ),
            ...toolMetadata(toolName),
          }
        }

        if (caller === "architect") {
          const contract = readActiveMissionContract(input.directory, spec.mission_id)
          const script = await loadMissionScript(input.directory, spec.mission_id)
          if (!script) {
            return {
              output: toolFail(toolName, "MISSION_SCRIPT_NOT_FOUND", "Active mission has no mission.script.ts"),
              ...toolMetadata(toolName),
            }
          }
          if (!script.plan) {
            return {
              output: toolFail(toolName, "MISSION_SCRIPT_PLAN_MISSING", "Active mission script has no compiled orchestration plan"),
              ...toolMetadata(toolName),
            }
          }
          const planWarnings = script.plan?.warnings.length ? script.plan.warnings : undefined

          const domains = await readSkillDomainsRegistry(input.directory)
          const skillReady = resolveSkillDomainAssignments(spec, script.plan, {
            ...(contract?.user_skill && { userSkill: contract.user_skill }),
            domains,
          })
          const specToBootstrap = skillReady
            ? applySkillDomainAssignments(spec, skillReady.assignments)
            : spec
          const bootstrap = await bootstrapMission(input, specToBootstrap, {
            objective: contract?.objective,
          })
          await registry.flushPendingDeliveries()
          return {
            output: toolOk(toolName, {
              phase: "bootstrapped",
              mission_id: spec.mission_id,
              node_count: bootstrap.node_count,
              skill_domains: skillReady ? "auto" : "deferred_to_retro",
              ...(planWarnings?.length && { plan_warnings: planWarnings }),
            }),
            ...toolMetadata(toolName),
          }
        }

        return {
          output: toolFail(toolName, "NOT_AUTHORIZED", "Only profile architect may call gatehouse_submit_orchestration"),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        if (error instanceof MissionScriptParseError) {
          const hint = missionScriptErrorHint(error.code)
          return {
            output: toolFail(
              toolName,
              error.code,
              error.message,
              hint ? { hint } : undefined,
            ),
            ...toolErrorMetadata(toolName),
          }
        }
        const message = error instanceof Error ? error.message : String(error)
        const code = message.includes("gatehouse_mission_start") ? "NO_ACTIVE_MISSION" : "SUBMIT_ORCHESTRATION_FAILED"
        return { output: toolFail(toolName, code, message), ...toolErrorMetadata(toolName) }
      }
    },
  })
}

async function resolveSubmitOrchestrationCaller(input: PluginInput, context: ToolContext) {
  const registry = await getRegistryStore(input)
  const sender = registry.bySession(context.sessionID)
  if (sender?.scope === "outer" && sender.profile === "architect") return "architect"
  if (context.agent === ARCHITECT_OPENCODE) return "architect"
  return undefined
}
