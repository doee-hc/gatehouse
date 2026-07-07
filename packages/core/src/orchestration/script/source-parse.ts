/** Shared source scanning helpers for orchestration plan/lint analysis. */

import { parenBraceDepthBefore } from "./source-depth.ts"

export function findCallEnd(source: string, openParenIndex: number) {
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

export function findMatchingBracket(source: string, openBracketIndex: number) {
  let depth = 0
  for (let i = openBracketIndex; i < source.length; i += 1) {
    const ch = source[i]!
    if (ch === "[") depth += 1
    else if (ch === "]") {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return source.length
}

export function findMatchingBrace(source: string, openBraceIndex: number) {
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

export function splitTopLevelCommaList(body: string) {
  const items: string[] = []
  let start = 0
  let depth = 0
  let inString: '"' | "'" | "`" | null = null
  let escape = false

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!
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
    if (ch === "(" || ch === "{" || ch === "[") depth += 1
    else if (ch === ")" || ch === "}" || ch === "]") depth -= 1
    else if (ch === "," && depth === 0) {
      const chunk = body.slice(start, i).trim()
      if (chunk) items.push(chunk)
      start = i + 1
    }
  }

  const last = body.slice(start).trim()
  if (last) items.push(last)
  return items
}

export function callBodyAt(source: string, matchIndex: number, matchText: string) {
  const openParen = matchIndex + matchText.indexOf("(")
  const closeParen = findCallEnd(source, openParen)
  return source.slice(openParen + 1, closeParen)
}

export function parseLiteralStringArray(fieldBody: string) {
  const items: string[] = []
  for (const idMatch of fieldBody.matchAll(/["'`]([^"'`]+)["'`]/g)) {
    if (idMatch[1]) items.push(idMatch[1])
  }
  return items
}

export function extractRunTargetFromStatement(statement: string) {
  const match = /ctx\.run\s*\(\s*["'`]([^"'`]+)["'`]/.exec(statement.trim())
  return match?.[1]
}

export function extractRunTargetIds(statement: string) {
  const id = extractRunTargetFromStatement(statement)
  return id ? [id] : []
}

/** Split a parallel array into per-track source chunks (each async arrow callback). */
export function extractParallelTrackBodies(statement: string) {
  const parallelMatch = /\bctx\.parallel\s*\(/.exec(statement)
  if (!parallelMatch) return null

  const openParenIndex = statement.indexOf("(", parallelMatch.index)
  if (openParenIndex < 0) return null

  const closeParenIndex = findCallEnd(statement, openParenIndex)
  const parallelArgs = statement.slice(openParenIndex + 1, closeParenIndex).trim()
  const openBracketIndex = parallelArgs.indexOf("[")
  if (openBracketIndex < 0) return null

  const closeBracketIndex = findMatchingBracket(parallelArgs, openBracketIndex)
  const arrayBody = parallelArgs.slice(openBracketIndex + 1, closeBracketIndex)
  return splitTopLevelCommaList(arrayBody)
}

export function extractAsyncArrowBody(trackSource: string) {
  const arrowBodyMatch = /=>\s*\{/.exec(trackSource)
  if (!arrowBodyMatch) return trackSource.trim()

  const openBraceIndex = trackSource.indexOf("{", arrowBodyMatch.index)
  if (openBraceIndex < 0) return trackSource.trim()

  const closeBraceIndex = findMatchingBrace(trackSource, openBraceIndex)
  return trackSource.slice(openBraceIndex + 1, closeBraceIndex).trim()
}

export function extractTopLevelAwaitStatements(source: string) {
  const trimmed = source.trim()
  const boundaryPattern = /\bawait\s+ctx\.(?:run|parallel)\s*\(/gm
  const starts: number[] = []
  let match: RegExpExecArray | null
  while ((match = boundaryPattern.exec(trimmed)) !== null) {
    if (parenBraceDepthBefore(trimmed, match.index) === 0) {
      starts.push(match.index)
    }
  }
  if (starts.length === 0) return []

  const statements: string[] = []
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i]!
    const end = i + 1 < starts.length ? starts[i + 1]! : trimmed.length
    const chunk = trimmed.slice(start, end).trim()
    if (chunk) statements.push(chunk)
  }
  return statements
}
