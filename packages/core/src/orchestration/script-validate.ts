import { validateTeamSpec } from "../tree/parse.ts"
import { MissionScriptParseError, parseMissionScriptSource, type ParsedMissionScript } from "./script-parse.ts"
import { compileOrchestrationPlan } from "./plan-compile.ts"
import type { OrchestrationPlan } from "./plan-types.ts"
import { validatePlanStepStatement } from "./plan-step-compile.ts"
import { simulateOrchestration } from "./simulate-orchestration.ts"
import { validateOrchestrateSyntax } from "./syntax.ts"
import { lintOrchestrationScript } from "./orchestration-lint.ts"
import type { TeamSpec } from "../tree/types.ts"

export type DryRunMissionScriptResult =
  | { ok: true; parsed: ParsedMissionScript; plan: OrchestrationPlan; warnings: string[] }
  | { ok: false; code: string; message: string }

export async function dryRunMissionScriptSource(
  source: string,
  expectedMissionId?: string,
): Promise<DryRunMissionScriptResult> {
  try {
    const parsed = parseMissionScriptSource(source, expectedMissionId)
    validateTeamSpec(parsed.team)
    validateOrchestrateStaticNodes(parsed.team, parsed.orchestrateSource)
    validateNoPortalPublishReferences(parsed.orchestrateSource)
    validateOrchestrateSyntaxOrThrow(parsed.orchestrateSource)
    if (parsed.meta?.phases) {
      for (const phase of parsed.meta.phases) {
        if (typeof phase !== "string" || !phase.trim()) {
          throw new MissionScriptParseError("SCRIPT_INVALID_META", "meta.phases must be non-empty strings")
        }
      }
    }
    if (!parsed.orchestrateSource?.trim()) {
      throw new MissionScriptParseError(
        "SCRIPT_MISSING_ORCHESTRATE",
        "mission.script.ts must export default async function orchestrate(ctx)",
      )
    }
    const lint = lintOrchestrationScript(parsed.team, parsed.orchestrateSource)
    for (const issue of lint.errors) {
      throw new MissionScriptParseError(issue.code, issue.message)
    }
    const plan = compileOrchestrationPlan({
      missionId: parsed.team.mission_id,
      team: parsed.team,
      orchestrateSource: parsed.orchestrateSource,
      scriptHash: parsed.scriptHash,
    })
    validatePlanStepsCompile(plan)
    const simulation = await simulateOrchestration({ parsed, plan })
    if (!simulation.ok) {
      return { ok: false, code: simulation.code, message: simulation.message }
    }
    return {
      ok: true,
      parsed,
      plan,
      warnings: [...lint.warnings, ...simulation.warnings, ...plan.warnings],
    }
  } catch (error) {
    if (error instanceof MissionScriptParseError) {
      return { ok: false, code: error.code, message: error.message }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, code: "SCRIPT_VALIDATE_FAILED", message }
  }
}

export function validatePlanStepsCompile(plan: OrchestrationPlan) {
  for (const step of plan.steps) {
    const checked = validatePlanStepStatement(step.statement)
    if (checked.ok) continue
    throw new MissionScriptParseError(
      "SCRIPT_INVALID_PLAN_STEP",
      `orchestrate plan step ${step.id} (${step.op}) is not valid JavaScript for sandbox replay: ${checked.message}. ` +
        "Avoid // line comments between ctx.phase / await ctx.* steps (they break per-step replay).",
    )
  }
}

function validateOrchestrateSyntaxOrThrow(orchestrateSource?: string) {
  if (!orchestrateSource) return
  const checked = validateOrchestrateSyntax(orchestrateSource)
  if (!checked.ok) {
    throw new MissionScriptParseError(
      "SCRIPT_INVALID_ORCHESTRATE_SYNTAX",
      `orchestrate body is not valid JavaScript: ${checked.message}`,
    )
  }
  validateOrchestrateNoRiskyDoubleQuotedStrings(orchestrateSource)
}

/** Catch common authoring mistakes that break AsyncFunction compile in subtle ways. */
function validateOrchestrateNoRiskyDoubleQuotedStrings(orchestrateSource: string) {
  const risky = /(?:note|context)\s*:\s*"[^"\n]*(?:gatehouse_|recipient=|message=)[^"\n]*"/g
  for (const match of orchestrateSource.matchAll(risky)) {
    const snippet = match[0].slice(0, 120)
    throw new MissionScriptParseError(
      "SCRIPT_RISKY_STRING_LITERAL",
      `orchestrate uses a risky double-quoted string (use template literals or single-quoted node ids): ${snippet}`,
    )
  }
}

function validateNoPortalPublishReferences(orchestrateSource?: string) {
  if (!orchestrateSource) return
  if (/gatehouse_publish_blog|\bpublish_blog\b/i.test(orchestrateSource)) {
    throw new MissionScriptParseError(
      "SCRIPT_FORBIDDEN_PUBLISH",
      "orchestrate must not reference gatehouse_publish_blog; Portal publish is system-managed on gatehouse_mission_complete(done)",
    )
  }
}

function extractRollupFromNodes(orchestrateSource: string) {
  const nodes = new Set<string>()
  const pattern = /rollupFrom\s*:\s*\[([^\]]*)\]/g
  for (const match of orchestrateSource.matchAll(pattern)) {
    const body = match[1] ?? ""
    for (const idMatch of body.matchAll(/["'`]([^"'`]+)["'`]/g)) {
      if (idMatch[1]) nodes.add(idMatch[1])
    }
  }
  return nodes
}

function validateOrchestrateStaticNodes(team: TeamSpec, orchestrateSource?: string) {
  if (!orchestrateSource) return
  const nodeIds = new Set(Object.keys(team.nodes))
  const patterns = [
    /ctx\.prompt\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /ctx\.setBrief\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /ctx\.waitFor\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /ctx\.waitForRollup\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /ctx\.template\.workOrder\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /ctx\.template\.rework\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /ctx\.template\.reworkResume\s*\(\s*["'`]([^"'`]+)["'`]/g,
  ]
  for (const pattern of patterns) {
    for (const match of orchestrateSource.matchAll(pattern)) {
      const nodeId = match[1]
      if (nodeId && !nodeIds.has(nodeId)) {
        throw new MissionScriptParseError(
          "SCRIPT_UNKNOWN_NODE",
          `orchestrate references unknown node_id: ${nodeId}`,
        )
      }
    }
  }
  for (const nodeId of extractRollupFromNodes(orchestrateSource)) {
    if (!nodeIds.has(nodeId)) {
      throw new MissionScriptParseError(
        "SCRIPT_UNKNOWN_NODE",
        `orchestrate rollupFrom references unknown node_id: ${nodeId}`,
      )
    }
  }
}
