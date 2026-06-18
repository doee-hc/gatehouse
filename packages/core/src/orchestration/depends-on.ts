import type { DependsOnEntry } from "./types.ts"

export type NormalizedDependsOn = {
  node: string
  summary: boolean
}

export function normalizeDependsOn(entries?: DependsOnEntry[]): NormalizedDependsOn[] {
  if (!entries?.length) return []
  const out: NormalizedDependsOn[] = []
  for (const entry of entries) {
    if (typeof entry === "string") {
      const node = entry.trim()
      if (node) out.push({ node, summary: false })
      continue
    }
    const node = entry.node.trim()
    if (node) out.push({ node, summary: entry.summary === true })
  }
  return out
}

/** Parse `dependsOn: [...]` array body from orchestration script source. */
export function parseDependsOnArrayBody(body: string): NormalizedDependsOn[] {
  const entries: NormalizedDependsOn[] = []
  let rest = body
  const objectPattern =
    /\{\s*node\s*:\s*["'`]([^"'`]+)["'`](?:\s*,\s*summary\s*:\s*(true|false))?\s*\}/g
  rest = rest.replace(objectPattern, (_match, node: string, summary?: string) => {
    entries.push({ node, summary: summary === "true" })
    return ""
  })
  for (const match of rest.matchAll(/["'`]([^"'`]+)["'`]/g)) {
    if (match[1]) entries.push({ node: match[1], summary: false })
  }
  return entries
}

export function extractDependsOnFromStatement(statement: string): NormalizedDependsOn[] {
  const match = /dependsOn\s*:\s*\[([\s\S]*?)\]/m.exec(statement)
  if (!match?.[1]) return []
  return parseDependsOnArrayBody(match[1])
}

export function waitNodeIds(deps: NormalizedDependsOn[]) {
  return [...new Set(deps.map((dep) => dep.node))]
}

export function summaryNodeIds(deps: NormalizedDependsOn[]) {
  return deps.filter((dep) => dep.summary).map((dep) => dep.node)
}

export function hasSummaryDepends(deps: NormalizedDependsOn[]) {
  return deps.some((dep) => dep.summary)
}
