import { childNodeIdsFromSpec } from "../tree/parse.ts"
import type { TeamSpec } from "../tree/types.ts"
import { parenBraceDepthBefore } from "./source-depth.ts"

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

function callBodyAt(source: string, matchIndex: number, matchText: string) {
  const openParen = matchIndex + matchText.indexOf("(")
  const closeParen = findCallEnd(source, openParen)
  return source.slice(openParen + 1, closeParen)
}

function literalIdsFromArrayBody(body: string) {
  const ids: string[] = []
  for (const idMatch of body.matchAll(/["'`]([^"'`]+)["'`]/g)) {
    if (idMatch[1]) ids.push(idMatch[1])
  }
  return ids
}

function runWaitsByDefault(body: string) {
  return !/\bwait\s*:\s*false\b/.test(body)
}

function runRepliesByDefault(body: string) {
  return !/\breply\s*:\s*false\b/.test(body)
}

/** Direct child of structural root in the ancestry chain; null for the root itself. */
export function missionTrackForNode(team: TeamSpec, nodeId: string): string | null {
  if (nodeId === team.root) return null
  let current = nodeId
  while (true) {
    const node = team.nodes[current]
    if (!node) return null
    const parent: string | null = node.parent
    if (parent === team.root) return current
    if (parent === null) return null
    current = parent
  }
}

function isDescendantOf(team: TeamSpec, ancestorId: string, nodeId: string) {
  let current: string | null = nodeId
  while (current) {
    if (current === ancestorId) return true
    const parent: string | null = team.nodes[current]?.parent ?? null
    if (parent === null) return false
    current = parent
  }
  return false
}

export function extractRunLiteralItems(orchestrateSource: string) {
  const items: string[] = []
  const pattern = /ctx\.run\s*\(\s*\[([^\]]*)\]/g
  for (const match of orchestrateSource.matchAll(pattern)) {
    items.push(...literalIdsFromArrayBody(match[1] ?? ""))
  }
  return items
}

export function extractSetBriefNodes(orchestrateSource: string) {
  const nodes = new Set<string>()
  const runSinglePattern = /ctx\.run\s*\(\s*["'`]([^"'`]+)["'`]/g
  for (const match of orchestrateSource.matchAll(runSinglePattern)) {
    const body = callBodyAt(orchestrateSource, match.index!, match[0])
    if (/\bbrief\s*:/.test(body) && match[1]) nodes.add(match[1])
  }
  const runArrayPattern = /ctx\.run\s*\(\s*\[([^\]]*)\]/g
  for (const match of orchestrateSource.matchAll(runArrayPattern)) {
    const body = callBodyAt(orchestrateSource, match.index!, match[0])
    if (!/\bbrief\s*:/.test(body)) continue
    for (const id of literalIdsFromArrayBody(match[1] ?? "")) nodes.add(id)
  }
  return nodes
}

export function extractOrchestrationEvents(orchestrateSource: string): OrchestrationEvent[] {
  const events: OrchestrationEvent[] = []

  const runSingle = /\bctx\.run\s*\(\s*["'`]([^"'`]+)["'`]/g
  for (const match of orchestrateSource.matchAll(runSingle)) {
    const index = match.index!
    const depth = parenBraceDepthBefore(orchestrateSource, index)
    const nodeId = match[1]!
    const body = callBodyAt(orchestrateSource, index, match[0])
    if (runRepliesByDefault(body)) events.push({ kind: "dispatch", nodeId, depth })
    if (runWaitsByDefault(body)) events.push({ kind: "wait", nodeId, depth })
  }

  const runArray = /\bctx\.run\s*\(\s*\[([^\]]*)\]/g
  for (const match of orchestrateSource.matchAll(runArray)) {
    const index = match.index!
    const depth = parenBraceDepthBefore(orchestrateSource, index)
    const body = callBodyAt(orchestrateSource, index, match[0])
    const ids = literalIdsFromArrayBody(match[1] ?? "")
    for (const nodeId of ids) {
      if (runRepliesByDefault(body)) events.push({ kind: "dispatch", nodeId, depth })
      if (runWaitsByDefault(body)) events.push({ kind: "wait", nodeId, depth })
    }
  }

  const joinSingle = /\bctx\.join\s*\(\s*["'`]([^"'`]+)["'`]/g
  for (const match of orchestrateSource.matchAll(joinSingle)) {
    const index = match.index!
    const depth = parenBraceDepthBefore(orchestrateSource, index)
    const body = callBodyAt(orchestrateSource, index, match[0])
    if (/subtree\s*:\s*true/.test(body)) continue
    events.push({ kind: "wait", nodeId: match[1]!, depth })
  }

  const joinArray = /\bctx\.join\s*\(\s*\[([^\]]*)\]/g
  for (const match of orchestrateSource.matchAll(joinArray)) {
    const index = match.index!
    const depth = parenBraceDepthBefore(orchestrateSource, index)
    for (const nodeId of literalIdsFromArrayBody(match[1] ?? "")) {
      events.push({ kind: "wait", nodeId, depth })
    }
  }

  return events
}

export function extractReferencedNodeIds(orchestrateSource: string) {
  const nodes = new Set<string>()
  const patterns = [
    /ctx\.(?:run|join)\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /ctx\.template\.workOrder\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /ctx\.template\.rework\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /ctx\.template\.reworkResume\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /rollupFrom\s*:\s*\[([^\]]*)\]/g,
  ]
  for (const pattern of patterns) {
    for (const match of orchestrateSource.matchAll(pattern)) {
      if (pattern.source.includes("rollupFrom")) {
        for (const id of literalIdsFromArrayBody(match[1] ?? "")) nodes.add(id)
        continue
      }
      if (match[1]) nodes.add(match[1])
    }
  }
  for (const id of extractRunLiteralItems(orchestrateSource)) nodes.add(id)
  for (const id of extractJoinLiteralItems(orchestrateSource)) nodes.add(id)
  return nodes
}

export function extractJoinLiteralItems(orchestrateSource: string) {
  const items: string[] = []
  const pattern = /ctx\.join\s*\(\s*\[([^\]]*)\]/g
  for (const match of orchestrateSource.matchAll(pattern)) {
    items.push(...literalIdsFromArrayBody(match[1] ?? ""))
  }
  return items
}

function findMatchingBrace(source: string, openBraceIndex: number) {
  let depth = 0
  let inString: '"' | "'" | "`" | null = null
  let escape = false
  for (let i = openBraceIndex; i < source.length; i += 1) {
    const ch = source[i]!
    if (escape) {
      escape = false
      continue
    }
    if (inString) {
      if (ch === "\\") escape = true
      else if (ch === inString) inString = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch
      continue
    }
    if (ch === "{") depth += 1
    else if (ch === "}") {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return source.length
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

function parseLiteralStringArray(fieldBody: string) {
  const items: string[] = []
  for (const idMatch of fieldBody.matchAll(/["'`]([^"'`]+)["'`]/g)) {
    if (idMatch[1]) items.push(idMatch[1])
  }
  return items
}

function extractLiteralBriefInner(body: string) {
  if (/\bbrief\s*:\s*\(/.test(body)) return undefined
  const match = /\bbrief\s*:\s*\{([\s\S]*?)\}/.exec(body)
  return match?.[1]
}

function collectRunCalls(orchestrateSource: string) {
  const calls: Array<{ nodeIds: string[]; body: string; index: number; matchText: string }> = []
  const runSingle = /\bctx\.run\s*\(\s*["'`]([^"'`]+)["'`]/g
  for (const match of orchestrateSource.matchAll(runSingle)) {
    calls.push({
      nodeIds: [match[1]!],
      body: callBodyAt(orchestrateSource, match.index!, match[0]),
      index: match.index!,
      matchText: match[0],
    })
  }
  const runArray = /\bctx\.run\s*\(\s*\[([^\]]*)\]/g
  for (const match of orchestrateSource.matchAll(runArray)) {
    calls.push({
      nodeIds: literalIdsFromArrayBody(match[1] ?? ""),
      body: callBodyAt(orchestrateSource, match.index!, match[0]),
      index: match.index!,
      matchText: match[0],
    })
  }
  return calls
}

function lintPlanDynamicTopLevel(orchestrateSource: string): OrchestrationLintIssue[] {
  const errors: OrchestrationLintIssue[] = []
  scanTopLevelLoopBodies(orchestrateSource, (body) => {
    if (!/\bctx\.(?:run|join)\s*\(/.test(body)) return
    errors.push({
      code: "SCRIPT_PLAN_DYNAMIC_TOP_LEVEL",
      message:
        "top-level for/while must not contain ctx.run or ctx.join; use ctx.fork tracks or explicit top-level await ctx.run/join steps for plan replay",
    })
  })
  return errors
}

function lintRollupOnFanout(orchestrateSource: string): OrchestrationLintIssue[] {
  const errors: OrchestrationLintIssue[] = []
  const runArray = /\bctx\.run\s*\(\s*\[([^\]]*)\]/g
  for (const match of orchestrateSource.matchAll(runArray)) {
    const body = callBodyAt(orchestrateSource, match.index!, match[0])
    if (!/rollupFrom\s*:/.test(body)) continue
    errors.push({
      code: "SCRIPT_ROLLUP_ON_FANOUT",
      message:
        "rollupFrom is ignored on ctx.run([...]) fan-out; use single-node ctx.run(coordinator, { rollupFrom: [...] }) after children complete",
    })
  }
  return errors
}

function lintForbiddenCtxRead(orchestrateSource: string): OrchestrationLintIssue[] {
  if (!/\bctx\.(?:readMissionContext|readContract)\s*\(/.test(orchestrateSource)) return []
  return [
    {
      code: "SCRIPT_FORBIDDEN_CTX_READ",
      message:
        "orchestrate must not call ctx.readMissionContext or ctx.readContract; inline static context in run brief or work-order text",
    },
  ]
}

function lintBriefQuality(team: TeamSpec, orchestrateSource: string): string[] {
  const warnings: string[] = []
  for (const call of collectRunCalls(orchestrateSource)) {
    if (!runRepliesByDefault(call.body)) continue
    const briefInner = extractLiteralBriefInner(call.body)
    if (briefInner === undefined) continue

    const yourWorkMatch = /your_work\s*:\s*\[([\s\S]*?)\]/.exec(briefInner)
    const acceptanceMatch = /acceptance_slice\s*:\s*\[([\s\S]*?)\]/.exec(briefInner)
    const yourWork = yourWorkMatch ? parseLiteralStringArray(yourWorkMatch[1] ?? "") : []
    const acceptance = acceptanceMatch ? parseLiteralStringArray(acceptanceMatch[1] ?? "") : []

    for (const nodeId of call.nodeIds) {
      if (!team.nodes[nodeId]) continue
      if (yourWork.length === 0) {
        warnings.push(`literal brief for "${nodeId}" has empty your_work`)
      }
      if (childNodeIdsFromSpec(team, nodeId).length === 0) {
        if (!acceptance.some((item) => /^path\s*:/i.test(item.trim()))) {
          warnings.push(`leaf node "${nodeId}" brief acceptance_slice has no path: entry`)
        }
      }
    }
  }
  return warnings
}

function lintWaitFalseWithoutJoin(orchestrateSource: string): string[] {
  const warnings: string[] = []
  const joined = new Set(
    extractOrchestrationEvents(orchestrateSource)
      .filter((event) => event.kind === "wait")
      .map((event) => event.nodeId),
  )

  for (const call of collectRunCalls(orchestrateSource)) {
    if (runWaitsByDefault(call.body)) continue
    for (const nodeId of call.nodeIds) {
      if (joined.has(nodeId)) continue
      warnings.push(`ctx.run(..., { wait: false }) on "${nodeId}" has no matching ctx.join`)
    }
  }
  return warnings
}

function lintNonLiteralNodeIds(orchestrateSource: string): string[] {
  const warnings: string[] = []
  const pattern = /\bctx\.(?:run|join)\s*\(\s*(?![\["'`])/g
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
  const pattern = /\bctx\.(?:run|join|fork)\s*\(/g
  for (const match of orchestrateSource.matchAll(pattern)) {
    const index = match.index!
    const before = orchestrateSource.slice(Math.max(0, index - 12), index)
    if (/\bawait\s*$/.test(before)) continue
    const op = match[0].replace(/\s*\($/, "")
    warnings.push(`${op}(...) should use await; floating orchestration calls may skip completion`)
  }
  return [...new Set(warnings)]
}

function extractRunCalls(orchestrateSource: string) {
  const calls: Array<{ coordinator: string; body: string }> = []
  const runPattern = /ctx\.run\s*\(\s*["'`]([^"'`]+)["'`]/g
  for (const match of orchestrateSource.matchAll(runPattern)) {
    const coordinator = match[1]!
    const body = callBodyAt(orchestrateSource, match.index!, match[0])
    if (runRepliesByDefault(body)) calls.push({ coordinator, body })
  }
  return calls
}

function lintLegacyApi(orchestrateSource: string): OrchestrationLintIssue[] {
  if (
    /ctx\.(?:setBrief|prompt|waitFor|waitForRollup|parallel|pipeline|phase|log)\s*\(/.test(
      orchestrateSource,
    )
  ) {
    return [
      {
        code: "SCRIPT_LEGACY_API",
        message:
          "orchestrate must use ctx.run / ctx.join / ctx.fork only; legacy setBrief/prompt/waitFor/parallel/pipeline APIs were removed",
      },
    ]
  }
  return []
}

function lintSerialTrackBlocking(team: TeamSpec, orchestrateSource: string): OrchestrationLintIssue[] {
  const errors: OrchestrationLintIssue[] = []
  const topLevel = extractOrchestrationEvents(orchestrateSource).filter((event) => event.depth === 0)
  const dispatched = new Set<string>()

  for (let i = 0; i < topLevel.length; i += 1) {
    const event = topLevel[i]!
    if (event.kind === "dispatch") {
      dispatched.add(event.nodeId)
      continue
    }

    const waitTrack = missionTrackForNode(team, event.nodeId)
    if (!waitTrack) continue

    for (const next of topLevel.slice(i + 1)) {
      if (next.kind !== "dispatch" || dispatched.has(next.nodeId)) continue
      const nextTrack = missionTrackForNode(team, next.nodeId)
      if (!nextTrack || nextTrack === waitTrack) continue
      errors.push({
        code: "SCRIPT_SERIAL_TRACK_BLOCK",
        message:
          `top-level join on "${event.nodeId}" blocks script before track "${nextTrack}" dispatches ` +
          `"${next.nodeId}"; dispatch all tracks first or wrap independent tracks in ctx.fork`,
      })
      break
    }
  }

  return errors
}

function lintRollupFrom(team: TeamSpec, orchestrateSource: string): {
  errors: OrchestrationLintIssue[]
  warnings: string[]
} {
  const errors: OrchestrationLintIssue[] = []
  const warnings: string[] = []

  for (const call of extractRunCalls(orchestrateSource)) {
    const rollupMatch = /rollupFrom\s*:\s*\[([^\]]*)\]/.exec(call.body)
    if (!rollupMatch) continue

    const coordinator = call.coordinator
    const rollupIds = literalIdsFromArrayBody(rollupMatch[1] ?? "")

    if (!team.nodes[coordinator]) continue

    for (const rollupId of rollupIds) {
      if (!team.nodes[rollupId]) {
        errors.push({
          code: "SCRIPT_UNKNOWN_NODE",
          message: `rollupFrom on "${coordinator}" references unknown node_id: ${rollupId}`,
        })
        continue
      }
      if (rollupId !== coordinator && !isDescendantOf(team, coordinator, rollupId)) {
        errors.push({
          code: "SCRIPT_INVALID_ROLLUP",
          message: `rollupFrom on "${coordinator}" includes "${rollupId}" which is not in its subtree`,
        })
      }
    }

    const directChildren = childNodeIdsFromSpec(team, coordinator)
    if (directChildren.length > 0 && rollupIds.length > 0) {
      const missing = directChildren.filter((childId) => !rollupIds.includes(childId))
      if (missing.length > 0) {
        warnings.push(
          `rollupFrom on "${coordinator}" omits direct children: ${missing.join(", ")}`,
        )
      }
    }
  }

  return { errors, warnings }
}

function lintBriefCoverage(team: TeamSpec, orchestrateSource: string): OrchestrationLintIssue[] {
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

  for (const nodeId of extractRunLiteralItems(orchestrateSource)) {
    if (!team.nodes[nodeId]) continue
    if (briefNodes.has(nodeId)) continue
    errors.push({
      code: "SCRIPT_MISSING_BRIEF",
      message: `orchestrate run([...]) includes "${nodeId}" but never provides brief for that node`,
    })
  }

  return errors
}

function lintUnusedTeamNodes(team: TeamSpec, orchestrateSource: string): string[] {
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
        `node "${event.nodeId}" has multiple run dispatch calls without an intervening join/wait`,
      )
    }
    lastDispatchIndex.set(event.nodeId, i)
  }

  return warnings
}

function lintEmptyFork(orchestrateSource: string): OrchestrationLintIssue[] {
  const errors: OrchestrationLintIssue[] = []
  if (/ctx\.fork\s*\(\s*\[\s*\]/.test(orchestrateSource)) {
    errors.push({
      code: "SCRIPT_EMPTY_FORK",
      message: "ctx.fork([]) has no tracks; remove the call or add tracks",
    })
  }
  if (/ctx\.run\s*\(\s*\[\s*\]/.test(orchestrateSource)) {
    errors.push({
      code: "SCRIPT_EMPTY_RUN",
      message: "ctx.run([]) has no nodes; remove the call or add node ids",
    })
  }
  return errors
}

function lintForbiddenPatterns(orchestrateSource: string): OrchestrationLintIssue[] {
  const errors: OrchestrationLintIssue[] = []
  if (/\bPromise\.all\s*\(/.test(orchestrateSource) && /\bctx\./.test(orchestrateSource)) {
    errors.push({
      code: "SCRIPT_FORBIDDEN_PROMISE_ALL",
      message: "orchestrate must not use Promise.all on ctx.*; use ctx.fork instead",
    })
  }
  return errors
}

function lintForkRecommended(team: TeamSpec, orchestrateSource: string): string[] {
  const warnings: string[] = []
  const tracks = new Set<string>()
  for (const nodeId of Object.keys(team.nodes)) {
    const track = missionTrackForNode(team, nodeId)
    if (track) tracks.add(track)
  }
  if (tracks.size < 2) return warnings
  if (/ctx\.fork\s*\(/.test(orchestrateSource)) return warnings

  const topWaits = extractOrchestrationEvents(orchestrateSource).filter(
    (event) => event.depth === 0 && event.kind === "wait",
  )
  const topDispatches = extractOrchestrationEvents(orchestrateSource).filter(
    (event) => event.depth === 0 && event.kind === "dispatch",
  )
  if (topWaits.length === 0 || topDispatches.length === 0) return warnings

  const waitTracks = new Set(
    topWaits.map((event) => missionTrackForNode(team, event.nodeId)).filter((track): track is string => !!track),
  )
  if (waitTracks.size >= 2) {
    warnings.push(
      `mission has ${tracks.size} sibling tracks (${[...tracks].join(", ")}) but no ctx.fork; ` +
        "sequential top-level joins may block independent tracks",
    )
  }

  return warnings
}

export function lintOrchestrationScript(team: TeamSpec, orchestrateSource: string): OrchestrationLintResult {
  const errors: OrchestrationLintIssue[] = []
  const warnings: string[] = []

  errors.push(...lintLegacyApi(orchestrateSource))
  errors.push(...lintForbiddenCtxRead(orchestrateSource))
  errors.push(...lintPlanDynamicTopLevel(orchestrateSource))
  errors.push(...lintRollupOnFanout(orchestrateSource))
  errors.push(...lintSerialTrackBlocking(team, orchestrateSource))
  errors.push(...lintBriefCoverage(team, orchestrateSource))
  errors.push(...lintEmptyFork(orchestrateSource))
  errors.push(...lintForbiddenPatterns(orchestrateSource))

  const rollup = lintRollupFrom(team, orchestrateSource)
  errors.push(...rollup.errors)
  warnings.push(...rollup.warnings)

  warnings.push(...lintBriefQuality(team, orchestrateSource))
  warnings.push(...lintWaitFalseWithoutJoin(orchestrateSource))
  warnings.push(...lintNonLiteralNodeIds(orchestrateSource))
  warnings.push(...lintMissingAwait(orchestrateSource))
  warnings.push(...lintUnusedTeamNodes(team, orchestrateSource))
  warnings.push(...lintDuplicateDispatches(orchestrateSource))
  warnings.push(...lintForkRecommended(team, orchestrateSource))

  const dedupedErrors = dedupeIssues(errors)
  const dedupedWarnings = [...new Set(warnings)]

  return { errors: dedupedErrors, warnings: dedupedWarnings }
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
