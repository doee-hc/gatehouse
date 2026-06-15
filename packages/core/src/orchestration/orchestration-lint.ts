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
  kind: "prompt" | "wait"
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

export function extractOrchestrationEvents(orchestrateSource: string): OrchestrationEvent[] {
  const events: OrchestrationEvent[] = []
  const pattern = /\bctx\.(?:prompt|waitFor)\s*\(\s*["'`]([^"'`]+)["'`]/g
  for (const match of orchestrateSource.matchAll(pattern)) {
    const index = match.index!
    const depth = parenBraceDepthBefore(orchestrateSource, index)
    const nodeId = match[1]!
    const isPrompt = match[0].includes("prompt")
    if (isPrompt) {
      const openParen = index + match[0].indexOf("(")
      const closeParen = findCallEnd(orchestrateSource, openParen)
      const callBody = orchestrateSource.slice(openParen + 1, closeParen)
      if (!/reply\s*:\s*true/.test(callBody)) continue
      events.push({ kind: "prompt", nodeId, depth })
      continue
    }
    events.push({ kind: "wait", nodeId, depth })
  }
  return events
}

export function extractSetBriefNodes(orchestrateSource: string) {
  const nodes = new Set<string>()
  const pattern = /ctx\.setBrief\s*\(\s*["'`]([^"'`]+)["'`]/g
  for (const match of orchestrateSource.matchAll(pattern)) {
    if (match[1]) nodes.add(match[1])
  }
  return nodes
}

export function extractPipelineLiteralItems(orchestrateSource: string) {
  const items: string[] = []
  const pattern = /ctx\.pipeline\s*\(\s*\[([^\]]*)\]/g
  for (const match of orchestrateSource.matchAll(pattern)) {
    const body = match[1] ?? ""
    for (const idMatch of body.matchAll(/["'`]([^"'`]+)["'`]/g)) {
      if (idMatch[1]) items.push(idMatch[1])
    }
  }
  return items
}

export function extractForOfLiteralArrays(orchestrateSource: string) {
  const items: string[] = []
  const pattern = /for\s*\(\s*const\s+\w+\s+of\s+\[([^\]]*)\]/g
  for (const match of orchestrateSource.matchAll(pattern)) {
    const body = match[1] ?? ""
    for (const idMatch of body.matchAll(/["'`]([^"'`]+)["'`]/g)) {
      if (idMatch[1]) items.push(idMatch[1])
    }
  }
  return items
}

export function extractReferencedNodeIds(orchestrateSource: string) {
  const nodes = new Set<string>()
  const patterns = [
    /ctx\.prompt\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /ctx\.setBrief\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /ctx\.waitFor\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /ctx\.waitForRollup\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /ctx\.template\.workOrder\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /ctx\.template\.rework\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /ctx\.template\.reworkResume\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /rollupFrom\s*:\s*\[([^\]]*)\]/g,
  ]
  for (const pattern of patterns) {
    for (const match of orchestrateSource.matchAll(pattern)) {
      if (pattern.source.includes("rollupFrom")) {
        const body = match[1] ?? ""
        for (const idMatch of body.matchAll(/["'`]([^"'`]+)["'`]/g)) {
          if (idMatch[1]) nodes.add(idMatch[1])
        }
        continue
      }
      if (match[1]) nodes.add(match[1])
    }
  }
  for (const id of extractPipelineLiteralItems(orchestrateSource)) nodes.add(id)
  for (const id of extractForOfLiteralArrays(orchestrateSource)) nodes.add(id)
  return nodes
}

function lintSerialTrackBlocking(team: TeamSpec, orchestrateSource: string): OrchestrationLintIssue[] {
  const errors: OrchestrationLintIssue[] = []
  const topLevel = extractOrchestrationEvents(orchestrateSource).filter((event) => event.depth === 0)
  const prompted = new Set<string>()

  for (let i = 0; i < topLevel.length; i += 1) {
    const event = topLevel[i]!
    if (event.kind === "prompt") {
      prompted.add(event.nodeId)
      continue
    }

    const waitTrack = missionTrackForNode(team, event.nodeId)
    if (!waitTrack) continue

    for (const next of topLevel.slice(i + 1)) {
      if (next.kind !== "prompt" || prompted.has(next.nodeId)) continue
      const nextTrack = missionTrackForNode(team, next.nodeId)
      if (!nextTrack || nextTrack === waitTrack) continue
      errors.push({
        code: "SCRIPT_SERIAL_TRACK_BLOCK",
        message:
          `top-level waitFor("${event.nodeId}") blocks script before track "${nextTrack}" dispatches ` +
          `"${next.nodeId}"; prompt all tracks first or wrap independent tracks in ctx.parallel`,
      })
      break
    }
  }

  return errors
}

function extractPromptCalls(orchestrateSource: string) {
  const calls: Array<{ coordinator: string; body: string }> = []
  const pattern = /ctx\.prompt\s*\(\s*["'`]([^"'`]+)["'`]/g
  for (const match of orchestrateSource.matchAll(pattern)) {
    const coordinator = match[1]!
    const openParen = match.index! + match[0].indexOf("(")
    const closeParen = findCallEnd(orchestrateSource, openParen)
    calls.push({ coordinator, body: orchestrateSource.slice(openParen + 1, closeParen) })
  }
  return calls
}

function lintRollupFrom(team: TeamSpec, orchestrateSource: string): {
  errors: OrchestrationLintIssue[]
  warnings: string[]
} {
  const errors: OrchestrationLintIssue[] = []
  const warnings: string[] = []

  for (const call of extractPromptCalls(orchestrateSource)) {
    const rollupMatch = /rollupFrom\s*:\s*\[([^\]]*)\]/.exec(call.body)
    if (!rollupMatch) continue

    const coordinator = call.coordinator
    const rollupBody = rollupMatch[1] ?? ""
    const rollupIds: string[] = []
    for (const idMatch of rollupBody.matchAll(/["'`]([^"'`]+)["'`]/g)) {
      if (idMatch[1]) rollupIds.push(idMatch[1])
    }

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

function extractPipelineStatements(orchestrateSource: string) {
  const statements: string[] = []
  const pattern = /ctx\.pipeline\s*\(/g
  for (const match of orchestrateSource.matchAll(pattern)) {
    const openParen = match.index! + match[0].length - 1
    const closeParen = findCallEnd(orchestrateSource, openParen)
    statements.push(orchestrateSource.slice(match.index!, closeParen + 1))
  }
  return statements
}

function lintBriefCoverage(team: TeamSpec, orchestrateSource: string): OrchestrationLintIssue[] {
  const errors: OrchestrationLintIssue[] = []
  const briefNodes = extractSetBriefNodes(orchestrateSource)
  const prompted = extractOrchestrationEvents(orchestrateSource).filter((event) => event.kind === "prompt")

  for (const event of prompted) {
    if (!team.nodes[event.nodeId]) continue
    if (!briefNodes.has(event.nodeId)) {
      errors.push({
        code: "SCRIPT_MISSING_BRIEF",
        message: `orchestrate prompts node "${event.nodeId}" with reply:true but never calls ctx.setBrief for that node`,
      })
    }
  }

  const pipelineStatements = extractPipelineStatements(orchestrateSource)
  for (const nodeId of extractPipelineLiteralItems(orchestrateSource)) {
    if (!team.nodes[nodeId]) continue
    if (briefNodes.has(nodeId)) continue
    const inDynamicPipeline = pipelineStatements.some(
      (statement) => statement.includes(nodeId) && /ctx\.setBrief\s*\(/.test(statement),
    )
    if (inDynamicPipeline) continue
    errors.push({
      code: "SCRIPT_MISSING_BRIEF",
      message: `orchestrate pipeline includes "${nodeId}" but never calls ctx.setBrief for that node`,
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

function lintDuplicateReplyPrompts(orchestrateSource: string): string[] {
  const warnings: string[] = []
  const events = extractOrchestrationEvents(orchestrateSource)
  const lastPromptIndex = new Map<string, number>()
  const lastWaitIndex = new Map<string, number>()

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i]!
    if (event.kind === "wait") {
      lastWaitIndex.set(event.nodeId, i)
      continue
    }
    const prevPrompt = lastPromptIndex.get(event.nodeId)
    const prevWait = lastWaitIndex.get(event.nodeId)
    if (prevPrompt !== undefined && (prevWait === undefined || prevWait < prevPrompt)) {
      warnings.push(
        `node "${event.nodeId}" has multiple prompt(reply:true) calls without an intervening waitFor`,
      )
    }
    lastPromptIndex.set(event.nodeId, i)
  }

  return warnings
}

function lintEmptyParallelPipeline(orchestrateSource: string): OrchestrationLintIssue[] {
  const errors: OrchestrationLintIssue[] = []
  if (/ctx\.parallel\s*\(\s*\[\s*\]/.test(orchestrateSource)) {
    errors.push({
      code: "SCRIPT_EMPTY_PARALLEL",
      message: "ctx.parallel([]) has no tracks; remove the call or add thunks",
    })
  }
  if (/ctx\.pipeline\s*\(\s*\[\s*\]/.test(orchestrateSource)) {
    errors.push({
      code: "SCRIPT_EMPTY_PIPELINE",
      message: "ctx.pipeline([]) has no items; remove the call or add items",
    })
  }
  return errors
}

function lintForbiddenPatterns(orchestrateSource: string): OrchestrationLintIssue[] {
  const errors: OrchestrationLintIssue[] = []
  if (/ctx\.waitForAll\s*\(/.test(orchestrateSource)) {
    errors.push({
      code: "SCRIPT_FORBIDDEN_WAIT_FOR_ALL",
      message:
        "orchestrate must not use ctx.waitForAll; use ctx.parallel for independent tracks or prompt siblings then await ctx.waitFor for each node",
    })
  }
  if (/\bPromise\.all\s*\(/.test(orchestrateSource) && /\bctx\./.test(orchestrateSource)) {
    errors.push({
      code: "SCRIPT_FORBIDDEN_PROMISE_ALL",
      message: "orchestrate must not use Promise.all on ctx.*; use ctx.parallel instead",
    })
  }
  return errors
}

function lintParallelRecommended(team: TeamSpec, orchestrateSource: string): string[] {
  const warnings: string[] = []
  const tracks = new Set<string>()
  for (const nodeId of Object.keys(team.nodes)) {
    const track = missionTrackForNode(team, nodeId)
    if (track) tracks.add(track)
  }
  if (tracks.size < 2) return warnings
  if (/ctx\.parallel\s*\(/.test(orchestrateSource)) return warnings

  const topWaits = extractOrchestrationEvents(orchestrateSource).filter(
    (event) => event.depth === 0 && event.kind === "wait",
  )
  const topPrompts = extractOrchestrationEvents(orchestrateSource).filter(
    (event) => event.depth === 0 && event.kind === "prompt",
  )
  if (topWaits.length === 0 || topPrompts.length === 0) return warnings

  const waitTracks = new Set(
    topWaits.map((event) => missionTrackForNode(team, event.nodeId)).filter((track): track is string => !!track),
  )
  if (waitTracks.size >= 2) {
    warnings.push(
      `mission has ${tracks.size} sibling tracks (${[...tracks].join(", ")}) but no ctx.parallel; ` +
        "sequential top-level waits may block independent tracks",
    )
  }

  return warnings
}

export function lintOrchestrationScript(team: TeamSpec, orchestrateSource: string): OrchestrationLintResult {
  const errors: OrchestrationLintIssue[] = []
  const warnings: string[] = []

  errors.push(...lintSerialTrackBlocking(team, orchestrateSource))
  errors.push(...lintBriefCoverage(team, orchestrateSource))
  errors.push(...lintEmptyParallelPipeline(orchestrateSource))
  errors.push(...lintForbiddenPatterns(orchestrateSource))

  const rollup = lintRollupFrom(team, orchestrateSource)
  errors.push(...rollup.errors)
  warnings.push(...rollup.warnings)

  warnings.push(...lintUnusedTeamNodes(team, orchestrateSource))
  warnings.push(...lintDuplicateReplyPrompts(orchestrateSource))
  warnings.push(...lintParallelRecommended(team, orchestrateSource))

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
