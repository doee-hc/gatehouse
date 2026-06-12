import { validateTeamSpec } from "../tree/parse.ts"
import { MissionScriptParseError, parseMissionScriptSource, type ParsedMissionScript } from "./script-parse.ts"
import type { TeamSpec } from "../tree/types.ts"

export type DryRunMissionScriptResult =
  | { ok: true; parsed: ParsedMissionScript }
  | { ok: false; code: string; message: string }

export function dryRunMissionScriptSource(source: string, expectedMissionId?: string): DryRunMissionScriptResult {
  try {
    const parsed = parseMissionScriptSource(source, expectedMissionId)
    validateTeamSpec(parsed.team)
    validateOrchestrateStaticNodes(parsed.team, parsed.orchestrateSource)
    validatePromptNodesHaveBrief(parsed.orchestrateSource)
    if (parsed.meta?.phases) {
      for (const phase of parsed.meta.phases) {
        if (typeof phase !== "string" || !phase.trim()) {
          throw new MissionScriptParseError("SCRIPT_INVALID_META", "meta.phases must be non-empty strings")
        }
      }
    }
    return { ok: true, parsed }
  } catch (error) {
    if (error instanceof MissionScriptParseError) {
      return { ok: false, code: error.code, message: error.message }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, code: "SCRIPT_VALIDATE_FAILED", message }
  }
}

function findCallEnd(source: string, openParenIndex: number) {
  let depth = 0
  for (let i = openParenIndex; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === "(") depth += 1
    else if (ch === ")") {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return source.length
}

function extractReplyPromptNodes(orchestrateSource: string) {
  const nodes = new Set<string>()
  const pattern = /ctx\.prompt\s*\(/g
  for (const match of orchestrateSource.matchAll(pattern)) {
    const openParen = match.index! + match[0].length - 1
    const closeParen = findCallEnd(orchestrateSource, openParen)
    const callBody = orchestrateSource.slice(openParen + 1, closeParen)
    const nodeMatch = callBody.match(/^\s*["'`]([^"'`]+)["'`]/)
    if (!nodeMatch?.[1]) continue
    if (/reply\s*:\s*true/.test(callBody)) nodes.add(nodeMatch[1])
  }
  return nodes
}

function extractSetBriefNodes(orchestrateSource: string) {
  const nodes = new Set<string>()
  const pattern = /ctx\.setBrief\s*\(\s*["'`]([^"'`]+)["'`]/g
  for (const match of orchestrateSource.matchAll(pattern)) {
    if (match[1]) nodes.add(match[1])
  }
  return nodes
}

function validatePromptNodesHaveBrief(orchestrateSource?: string) {
  if (!orchestrateSource) return
  const briefNodes = extractSetBriefNodes(orchestrateSource)
  for (const nodeId of extractReplyPromptNodes(orchestrateSource)) {
    if (!briefNodes.has(nodeId)) {
      throw new MissionScriptParseError(
        "SCRIPT_MISSING_BRIEF",
        `orchestrate prompts node "${nodeId}" with reply:true but never calls ctx.setBrief for that node`,
      )
    }
  }
}

function validateOrchestrateStaticNodes(team: TeamSpec, orchestrateSource?: string) {
  if (!orchestrateSource) return
  const nodeIds = new Set(Object.keys(team.nodes))
  const patterns = [
    /ctx\.prompt\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /ctx\.setBrief\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /ctx\.waitFor\s*\(\s*["'`]([^"'`]+)["'`]/g,
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
}
