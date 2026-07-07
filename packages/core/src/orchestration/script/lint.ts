import {
  planChildNodeIds,
  planLeafNodeIds,
  planTrackForNode,
} from "../plan/graph.ts"
import type { OrchestrationPlan } from "../plan/types.ts"
import type { MissionTeamSpec } from "../../missions/manifest/types.ts"
import { isCoordinationReportPath } from "../../delivery/publish-policy.ts"
import { parseDependsOnArrayBody } from "../engine/depends-on.ts"
import { parenBraceDepthBefore } from "./source-depth.ts"
import {
  callBodyAt,
  findCallEnd,
  findMatchingBrace,
  parseLiteralStringArray,
} from "./source-parse.ts"

export type OrchestrationLintIssue = {
  code: string
  message: string
}

export type OrchestrationLintResult = {
  errors: OrchestrationLintIssue[]
  warnings: string[]
}

type OrchestrationEvent = {
  kind: "dispatch" | "wait"
  nodeId: string
  depth: number
}

function runRepliesByDefault(body: string) {
  return !/\breply\s*:\s*false\b/.test(body)
}

function collectRunCalls(orchestrateSource: string, opts?: { repliesOnly?: boolean }) {
  const calls: Array<{ nodeId: string; body: string; index: number; matchText: string }> = []
  const runSingle = /\bctx\.run\s*\(\s*["'`]([^"'`]+)["'`]/g
  for (const match of orchestrateSource.matchAll(runSingle)) {
    const body = callBodyAt(orchestrateSource, match.index!, match[0])
    if (opts?.repliesOnly && !runRepliesByDefault(body)) continue
    calls.push({
      nodeId: match[1]!,
      body,
      index: match.index!,
      matchText: match[0],
    })
  }
  return calls
}

export function extractSetBriefNodes(orchestrateSource: string) {
  const nodes = new Set<string>()
  for (const call of collectRunCalls(orchestrateSource)) {
    if (/\bbrief\s*:/.test(call.body)) nodes.add(call.nodeId)
  }
  return nodes
}

export function extractOrchestrationEvents(orchestrateSource: string): OrchestrationEvent[] {
  const events: OrchestrationEvent[] = []

  for (const call of collectRunCalls(orchestrateSource)) {
    const depth = parenBraceDepthBefore(orchestrateSource, call.index)
    if (runRepliesByDefault(call.body)) {
      events.push({ kind: "dispatch", nodeId: call.nodeId, depth })
      events.push({ kind: "wait", nodeId: call.nodeId, depth })
    }
  }

  return events
}

export function extractReferencedNodeIds(orchestrateSource: string) {
  const nodes = new Set<string>()
  const patterns = [
    /ctx\.run\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /dependsOn\s*:\s*\[([^\]]*)\]/g,
  ]
  for (const pattern of patterns) {
    for (const match of orchestrateSource.matchAll(pattern)) {
      if (pattern.source.includes("dependsOn")) {
        for (const dep of parseDependsOnArrayBody(match[1] ?? "")) nodes.add(dep.node)
        continue
      }
      if (match[1]) nodes.add(match[1])
    }
  }
  return nodes
}

function scanTopLevelLoopBodies(orchestrateSource: string, visit: (body: string) => void) {
  const loopPattern = /\b(?:for|while)\s*\(/g
  for (const match of orchestrateSource.matchAll(loopPattern)) {
    const index = match.index!
    if (parenBraceDepthBefore(orchestrateSource, index) !== 0) continue
    const openParen = orchestrateSource.indexOf("(", index)
    if (openParen < 0) continue
    const closeParen = findCallEnd(orchestrateSource, openParen)
    let i = closeParen + 1
    while (i < orchestrateSource.length && /\s/.test(orchestrateSource[i]!)) i += 1
    if (orchestrateSource[i] === "{") {
      const end = findMatchingBrace(orchestrateSource, i)
      visit(orchestrateSource.slice(i + 1, end))
      continue
    }
    let end = i
    while (end < orchestrateSource.length && orchestrateSource[end] !== ";") end += 1
    visit(orchestrateSource.slice(i, end))
  }
}

function extractLiteralBriefInner(body: string) {
  if (/\bbrief\s*:\s*\(/.test(body)) return undefined
  const match = /\bbrief\s*:\s*\{([\s\S]*?)\}/.exec(body)
  return match?.[1]
}

function lintPlanDynamicTopLevel(orchestrateSource: string): OrchestrationLintIssue[] {
  const errors: OrchestrationLintIssue[] = []
  scanTopLevelLoopBodies(orchestrateSource, (body) => {
    if (!/\bctx\.run\s*\(/.test(body)) return
    errors.push({
      code: "SCRIPT_PLAN_DYNAMIC_TOP_LEVEL",
      message:
        "top-level for/while must not contain ctx.run; use ctx.parallel tracks or explicit top-level await ctx.run steps for plan replay",
    })
  })
  return errors
}

function lintForbiddenWorkOrderTemplate(orchestrateSource: string): OrchestrationLintIssue[] {
  if (!/\bctx\.template\.workOrder\s*\(/.test(orchestrateSource)) return []
  return [
    {
      code: "SCRIPT_FORBIDDEN_WORK_ORDER_TEMPLATE",
      message:
        "orchestrate must not call ctx.template.workOrder; Gatehouse auto-generates work orders — pass optional supplementary text as ctx.run(..., { text: \"...\" })",
    },
  ]
}

function lintForbiddenCtxRead(orchestrateSource: string): OrchestrationLintIssue[] {
  if (!/\bctx\.(?:readMissionContext|readContract)\s*\(/.test(orchestrateSource)) return []
  return [
    {
      code: "SCRIPT_FORBIDDEN_CTX_READ",
      message:
        "orchestrate must not call ctx.readMissionContext or ctx.readContract; inline static context in run brief or text",
    },
  ]
}

function lintReplyFalseWithoutText(orchestrateSource: string): OrchestrationLintIssue[] {
  const errors: OrchestrationLintIssue[] = []
  for (const call of collectRunCalls(orchestrateSource)) {
    if (runRepliesByDefault(call.body)) continue
    if (/\btext\s*:/.test(call.body)) continue
    errors.push({
      code: "SCRIPT_REPLY_FALSE_WITHOUT_TEXT",
      message:
        `node "${call.nodeId}" uses reply:false without text; brief is only delivered with activation text — omit reply or add text`,
    })
  }
  return errors
}

function parseAcceptancePathFromLiteral(item: string) {
  const trimmed = item.trim()
  const match = trimmed.match(/^path:\s*(.+)$/i)
  return match?.[1]?.trim()
}

function lintGatehouseDeliverablePaths(orchestrateSource: string): OrchestrationLintIssue[] {
  const errors: OrchestrationLintIssue[] = []
  for (const call of collectRunCalls(orchestrateSource)) {
    const briefInner = extractLiteralBriefInner(call.body)
    if (!briefInner) continue
    const acceptanceMatch = /acceptance_slice\s*:\s*\[([\s\S]*?)\]/.exec(briefInner)
    const acceptance = acceptanceMatch ? parseLiteralStringArray(acceptanceMatch[1] ?? "") : []
    for (const item of acceptance) {
      const deliverablePath = parseAcceptancePathFromLiteral(item)
      if (!deliverablePath) continue
      if (!isCoordinationReportPath(deliverablePath) && !deliverablePath.startsWith(".gatehouse/")) continue
      errors.push({
        code: "SCRIPT_ACCEPTANCE_GATEHOUSE_PATH",
        message:
          `node "${call.nodeId}" acceptance_slice uses "${deliverablePath}" under .gatehouse/; ` +
          `use a project path (e.g. "path: ${call.nodeId}/" or "path: reports/${call.nodeId}/") — inner deliverables must not live in .gatehouse/`,
      })
    }
  }
  return errors
}

function lintAggregatorHandoff(orchestrateSource: string): string[] {
  const warnings: string[] = []
  for (const call of collectRunCalls(orchestrateSource, { repliesOnly: true })) {
    const dependsMatch = /dependsOn\s*:\s*\[([\s\S]*?)\]/m.exec(call.body)
    const dependsOn = dependsMatch ? parseDependsOnArrayBody(dependsMatch[1] ?? "") : []
    const deliverableIds = dependsOn.filter((dep) => dep.deliverable).map((dep) => dep.node)
    if (deliverableIds.length < 2) continue
    const hasCompletionSchema =
      /\bcompletion_schema\s*:/.test(call.body) || /\bcompletionSchema\s*:/.test(call.body)
    if (hasCompletionSchema) continue
    warnings.push(
      `node "${call.nodeId}" aggregates ${deliverableIds.length} deliverable upstream nodes; ` +
        "consider completionSchema on upstream leaves for machine-readable handoff, or ensure each upstream acceptance_slice uses a stable project path (e.g. `<node_id>/`)",
    )
  }
  return warnings
}

function lintBriefQuality(team: MissionTeamSpec, plan: OrchestrationPlan, orchestrateSource: string): string[] {
  const warnings: string[] = []
  for (const call of collectRunCalls(orchestrateSource, { repliesOnly: true })) {
    const briefInner = extractLiteralBriefInner(call.body)
    if (briefInner === undefined) continue

    const yourWorkMatch = /your_work\s*:\s*\[([\s\S]*?)\]/.exec(briefInner)
    const acceptanceMatch = /acceptance_slice\s*:\s*\[([\s\S]*?)\]/.exec(briefInner)
    const yourWork = yourWorkMatch ? parseLiteralStringArray(yourWorkMatch[1] ?? "") : []
    const acceptance = acceptanceMatch ? parseLiteralStringArray(acceptanceMatch[1] ?? "") : []

    if (!team.nodes[call.nodeId]) continue
    if (yourWork.length === 0) {
      warnings.push(`literal brief for "${call.nodeId}" has empty your_work`)
    }
    if (planLeafNodeIds(team, plan).includes(call.nodeId)) {
      if (!acceptance.some((item) => /^path\s*:/i.test(item.trim()))) {
        warnings.push(`leaf node "${call.nodeId}" brief acceptance_slice has no path: entry`)
      }
    }
  }
  return warnings
}

function lintNonLiteralNodeIds(orchestrateSource: string): string[] {
  const warnings: string[] = []
  const pattern = /\bctx\.run\s*\(\s*(?![\["'`])/g
  for (const match of orchestrateSource.matchAll(pattern)) {
    const snippet = orchestrateSource.slice(match.index!, match.index! + 40).replace(/\s+/g, " ")
    warnings.push(
      `orchestrate uses non-literal node id (${snippet.trim()}…); prefer string literals for plan/resume`,
    )
  }
  return warnings
}

function lintMissingAwait(orchestrateSource: string): string[] {
  const warnings: string[] = []
  const pattern = /\bctx\.(?:run|parallel|pipeline)\s*\(/g
  for (const match of orchestrateSource.matchAll(pattern)) {
    const index = match.index!
    const before = orchestrateSource.slice(Math.max(0, index - 12), index)
    if (/\bawait\s*$/.test(before)) continue
    const op = match[0].replace(/\s*\($/, "")
    warnings.push(`${op}(...) should use await; floating orchestration calls may skip completion`)
  }
  return [...new Set(warnings)]
}

function lintSerialTrackBlocking(team: MissionTeamSpec, plan: OrchestrationPlan, orchestrateSource: string): OrchestrationLintIssue[] {
  const errors: OrchestrationLintIssue[] = []
  const topLevel = extractOrchestrationEvents(orchestrateSource).filter((event) => event.depth === 0)
  const dispatched = new Set<string>()

  for (let i = 0; i < topLevel.length; i += 1) {
    const event = topLevel[i]!
    if (event.kind === "dispatch") {
      dispatched.add(event.nodeId)
      continue
    }

    const waitTrack = planTrackForNode(plan, team, event.nodeId)
    if (!waitTrack) continue

    for (const next of topLevel.slice(i + 1)) {
      if (next.kind !== "dispatch" || dispatched.has(next.nodeId)) continue
      const nextTrack = planTrackForNode(plan, team, next.nodeId)
      if (!nextTrack || nextTrack === waitTrack) continue
      errors.push({
        code: "SCRIPT_SERIAL_TRACK_BLOCK",
        message:
          `top-level wait on "${event.nodeId}" blocks script before track "${nextTrack}" dispatches ` +
          `"${next.nodeId}"; dispatch all tracks first or wrap independent tracks in ctx.parallel`,
      })
      break
    }
  }

  return errors
}

function lintDependsOn(team: MissionTeamSpec, plan: OrchestrationPlan, orchestrateSource: string): {
  errors: OrchestrationLintIssue[]
  warnings: string[]
} {
  const errors: OrchestrationLintIssue[] = []
  const warnings: string[] = []

  for (const call of collectRunCalls(orchestrateSource, { repliesOnly: true })) {
    const nodeId = call.nodeId
    if (!team.nodes[nodeId]) continue

    const dependsMatch = /dependsOn\s*:\s*\[([\s\S]*?)\]/m.exec(call.body)
    const dependsOn = dependsMatch ? parseDependsOnArrayBody(dependsMatch[1] ?? "") : []
    const deliverableIds = dependsOn.filter((dep) => dep.deliverable).map((dep) => dep.node)

    for (const dep of dependsOn) {
      if (!team.nodes[dep.node]) {
        errors.push({
          code: "SCRIPT_UNKNOWN_NODE",
          message: `run on "${nodeId}" references unknown node_id in dependsOn: ${dep.node}`,
        })
      }
    }

    const directChildren = planChildNodeIds(plan, nodeId)
    if (directChildren.length > 0 && deliverableIds.length > 0) {
      const missing = directChildren.filter((childId) => !deliverableIds.includes(childId))
      if (missing.length > 0) {
        warnings.push(
          `dependsOn deliverable on "${nodeId}" omits direct children: ${missing.join(", ")}`,
        )
      }
    }
  }

  return { errors, warnings }
}

function lintBriefCoverage(team: MissionTeamSpec, orchestrateSource: string): OrchestrationLintIssue[] {
  const errors: OrchestrationLintIssue[] = []
  const briefNodes = extractSetBriefNodes(orchestrateSource)
  const dispatched = extractOrchestrationEvents(orchestrateSource).filter((event) => event.kind === "dispatch")

  for (const event of dispatched) {
    if (!team.nodes[event.nodeId]) continue
    if (!briefNodes.has(event.nodeId)) {
      errors.push({
        code: "SCRIPT_MISSING_BRIEF",
        message: `orchestrate run dispatches node "${event.nodeId}" but never provides brief in ctx.run`,
      })
    }
  }

  return errors
}

function lintUnusedTeamNodes(team: MissionTeamSpec, orchestrateSource: string): string[] {
  const referenced = extractReferencedNodeIds(orchestrateSource)
  const warnings: string[] = []
  for (const nodeId of Object.keys(team.nodes)) {
    if (!referenced.has(nodeId)) {
      warnings.push(`team node "${nodeId}" is never referenced in orchestrate()`)
    }
  }
  return warnings
}

function lintDuplicateDispatches(orchestrateSource: string): string[] {
  const warnings: string[] = []
  const events = extractOrchestrationEvents(orchestrateSource)
  const lastDispatchIndex = new Map<string, number>()
  const lastWaitIndex = new Map<string, number>()

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i]!
    if (event.kind === "wait") {
      lastWaitIndex.set(event.nodeId, i)
      continue
    }
    const prevDispatch = lastDispatchIndex.get(event.nodeId)
    const prevWait = lastWaitIndex.get(event.nodeId)
    if (prevDispatch !== undefined && (prevWait === undefined || prevWait < prevDispatch)) {
      warnings.push(
        `node "${event.nodeId}" has multiple run dispatch calls without an intervening completion wait`,
      )
    }
    lastDispatchIndex.set(event.nodeId, i)
  }

  return warnings
}

function lintEmptyParallel(orchestrateSource: string): OrchestrationLintIssue[] {
  const errors: OrchestrationLintIssue[] = []
  if (/ctx\.parallel\s*\(\s*\[\s*\]/.test(orchestrateSource)) {
    errors.push({
      code: "SCRIPT_EMPTY_PARALLEL",
      message: "ctx.parallel([]) has no tracks; remove the call or add tracks",
    })
  }
  return errors
}

function lintEmptyPipeline(orchestrateSource: string): OrchestrationLintIssue[] {
  const errors: OrchestrationLintIssue[] = []
  if (/ctx\.pipeline\s*\(\s*\[\s*\]/.test(orchestrateSource)) {
    errors.push({
      code: "SCRIPT_EMPTY_PIPELINE",
      message: "ctx.pipeline([]) has no items; remove the call or pass items",
    })
  }
  return errors
}

function lintForbiddenPatterns(orchestrateSource: string): OrchestrationLintIssue[] {
  const errors: OrchestrationLintIssue[] = []
  if (/\bPromise\.all\s*\(/.test(orchestrateSource) && /\bctx\./.test(orchestrateSource)) {
    errors.push({
      code: "SCRIPT_FORBIDDEN_PROMISE_ALL",
      message: "orchestrate must not use Promise.all on ctx.*; use ctx.parallel instead",
    })
  }
  return errors
}

function lintParallelRecommended(team: MissionTeamSpec, plan: OrchestrationPlan, orchestrateSource: string): string[] {
  const warnings: string[] = []
  const tracks = new Set<string>()
  for (const nodeId of Object.keys(team.nodes)) {
    const track = planTrackForNode(plan, team, nodeId)
    if (track) tracks.add(track)
  }
  if (tracks.size < 2) return warnings
  if (/ctx\.parallel\s*\(/.test(orchestrateSource)) return warnings

  const topWaits = extractOrchestrationEvents(orchestrateSource).filter(
    (event) => event.depth === 0 && event.kind === "wait",
  )
  const topDispatches = extractOrchestrationEvents(orchestrateSource).filter(
    (event) => event.depth === 0 && event.kind === "dispatch",
  )
  if (topWaits.length === 0 || topDispatches.length === 0) return warnings

  const waitTracks = new Set(
    topWaits.map((event) => planTrackForNode(plan, team, event.nodeId)).filter((track): track is string => !!track),
  )
  if (waitTracks.size >= 2) {
    warnings.push(
      `mission has ${tracks.size} sibling tracks (${[...tracks].join(", ")}) but no ctx.parallel; ` +
        "sequential top-level runs may block independent tracks",
    )
  }

  return warnings
}

export function lintOrchestrationScript(
  team: MissionTeamSpec,
  plan: OrchestrationPlan,
  orchestrateSource: string,
): OrchestrationLintResult {
  const errors: OrchestrationLintIssue[] = []
  const warnings: string[] = []

  errors.push(...lintForbiddenWorkOrderTemplate(orchestrateSource))
  errors.push(...lintForbiddenCtxRead(orchestrateSource))
  errors.push(...lintPlanDynamicTopLevel(orchestrateSource))
  errors.push(...lintSerialTrackBlocking(team, plan, orchestrateSource))
  errors.push(...lintBriefCoverage(team, orchestrateSource))
  errors.push(...lintEmptyParallel(orchestrateSource))
  errors.push(...lintEmptyPipeline(orchestrateSource))
  errors.push(...lintForbiddenPatterns(orchestrateSource))
  errors.push(...lintGatehouseDeliverablePaths(orchestrateSource))
  errors.push(...lintReplyFalseWithoutText(orchestrateSource))

  const dependsOn = lintDependsOn(team, plan, orchestrateSource)
  errors.push(...dependsOn.errors)
  warnings.push(...dependsOn.warnings)

  warnings.push(...lintBriefQuality(team, plan, orchestrateSource))
  warnings.push(...lintNonLiteralNodeIds(orchestrateSource))
  warnings.push(...lintMissingAwait(orchestrateSource))
  warnings.push(...lintUnusedTeamNodes(team, orchestrateSource))
  warnings.push(...lintDuplicateDispatches(orchestrateSource))
  warnings.push(...lintParallelRecommended(team, plan, orchestrateSource))
  warnings.push(...lintAggregatorHandoff(orchestrateSource))

  return {
    errors: dedupeIssues(errors),
    warnings: [...new Set(warnings)],
  }
}

function dedupeIssues(issues: OrchestrationLintIssue[]) {
  const seen = new Set<string>()
  const out: OrchestrationLintIssue[] = []
  for (const issue of issues) {
    const key = `${issue.code}:${issue.message}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(issue)
  }
  return out
}
