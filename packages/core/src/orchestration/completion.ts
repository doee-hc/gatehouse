import { gatehouseMessage } from "../i18n.ts"
import type { GatehouseLocale } from "../locale.ts"
import type { TeamSpec } from "../tree/types.ts"
import type { NodeCompletion, OrchestrationState } from "./types.ts"

export type NodeArtifact = {
  path: string
  description: string
}

function parseArtifactRecord(raw: unknown): NodeArtifact | undefined {
  if (!raw || typeof raw !== "object") return
  const record = raw as Record<string, unknown>
  const artifactPath = typeof record.path === "string" ? record.path.trim() : ""
  const description = typeof record.description === "string" ? record.description.trim() : ""
  if (!artifactPath || !description) return
  return { path: artifactPath.replace(/\\/g, "/").replace(/^\.\//, ""), description }
}

function parseArtifactsArray(parsed: unknown): NodeArtifact[] {
  if (!Array.isArray(parsed)) throw new Error("artifacts must be a JSON array")
  return parsed.flatMap((item) => {
    const artifact = parseArtifactRecord(item)
    return artifact ? [artifact] : []
  })
}

/** Accept JSON string or array — agents often pass structured artifacts as an object. */
export function parseArtifactsInput(raw: unknown): NodeArtifact[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === "string") {
    if (!raw.trim()) return undefined
    const parsed = parseArtifactsArray(JSON.parse(raw))
    return parsed.length ? parsed : undefined
  }
  if (Array.isArray(raw)) {
    const parsed = parseArtifactsArray(raw)
    return parsed.length ? parsed : undefined
  }
  throw new Error("artifacts must be a JSON array string or array")
}

export function parseRisksInput(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === "string") {
    if (!raw.trim()) return undefined
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) throw new Error("risks must be a JSON array of strings")
    const risks = parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    return risks.length ? risks : undefined
  }
  if (Array.isArray(raw)) {
    const risks = raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    return risks.length ? risks : undefined
  }
  throw new Error("risks must be a JSON array string or array")
}

export class RollupValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly nodeId?: string,
  ) {
    super(message)
    this.name = "RollupValidationError"
  }
}

export function assertRollupFromReady(
  team: TeamSpec,
  state: OrchestrationState,
  rollupFrom: string[],
) {
  if (rollupFrom.length === 0) return
  for (const nodeId of rollupFrom) {
    if (!team.nodes[nodeId]) {
      throw new RollupValidationError("ROLLUP_UNKNOWN_NODE", `rollupFrom references unknown node: ${nodeId}`, nodeId)
    }
    const node = state.nodes[nodeId]
    if (!node || node.status !== "done") {
      throw new RollupValidationError(
        "ROLLUP_NODE_NOT_DONE",
        `rollupFrom node ${nodeId} is not done (status: ${node?.status ?? "missing"})`,
        nodeId,
      )
    }
    if (!node.completion?.summary?.trim()) {
      throw new RollupValidationError(
        "ROLLUP_MISSING_COMPLETION",
        `rollupFrom node ${nodeId} has no structured completion; call gatehouse_execution_complete with summary first`,
        nodeId,
      )
    }
  }
}

export function formatNodeCompletionSection(
  locale: GatehouseLocale,
  nodeId: string,
  completion: NodeCompletion,
) {
  const lines = [
    `### ${gatehouseMessage("completion.rollup.nodeHeader", locale, { node_id: nodeId })}`,
    "",
    completion.summary.trim(),
  ]
  if (completion.artifacts?.length) {
    lines.push("", gatehouseMessage("completion.rollup.artifactsHeader", locale))
    for (const artifact of completion.artifacts) {
      lines.push(`- \`${artifact.path}\` — ${artifact.description}`)
    }
  }
  const risks = completion.risks?.filter((item) => item.trim())
  if (risks?.length) {
    lines.push("", gatehouseMessage("completion.rollup.risksHeader", locale))
    for (const risk of risks) lines.push(`- ${risk}`)
  }
  return lines.join("\n")
}

export function formatRollupInjectionBlock(
  locale: GatehouseLocale,
  state: OrchestrationState,
  rollupFrom: string[],
) {
  if (rollupFrom.length === 0) return ""
  const sections = rollupFrom.map((nodeId) => {
    const completion = state.nodes[nodeId]?.completion
    if (!completion) {
      return `### ${nodeId}\n\n(${gatehouseMessage("completion.rollup.missing", locale)})`
    }
    return formatNodeCompletionSection(locale, nodeId, completion)
  })
  return [
    gatehouseMessage("completion.rollup.header", locale),
    "",
    gatehouseMessage("completion.rollup.hint", locale),
    "",
    ...sections,
  ].join("\n")
}

export function synthesizeRootDeliveryMarkdown(
  locale: GatehouseLocale,
  missionId: string,
  rootNodeId: string,
  state: OrchestrationState,
  team: TeamSpec,
) {
  const rootCompletion = state.nodes[rootNodeId]?.completion
  const directChildren = Object.entries(team.nodes)
    .filter(([, node]) => node.parent === rootNodeId)
    .map(([nodeId]) => nodeId)
    .filter((nodeId) => state.nodes[nodeId]?.status === "done" && state.nodes[nodeId]?.completion)

  const lines = [
    `# ${gatehouseMessage("completion.rootDelivery.title", locale, { mission_id: missionId })}`,
    "",
    gatehouseMessage("completion.rootDelivery.generated", locale),
    "",
  ]

  if (rootCompletion?.summary?.trim()) {
    lines.push(`## ${gatehouseMessage("completion.rootDelivery.rootSummary", locale)}`, "", rootCompletion.summary.trim(), "")
    if (rootCompletion.artifacts?.length) {
      lines.push(gatehouseMessage("completion.rootDelivery.rootArtifacts", locale))
      for (const artifact of rootCompletion.artifacts) {
        lines.push(`- \`${artifact.path}\` — ${artifact.description}`)
      }
      lines.push("")
    }
  }

  if (directChildren.length > 0) {
    lines.push(`## ${gatehouseMessage("completion.rootDelivery.childRollup", locale)}`, "")
    for (const childId of directChildren) {
      const completion = state.nodes[childId]?.completion
      if (!completion) continue
      lines.push(formatNodeCompletionSection(locale, childId, completion), "")
    }
  }

  return lines.join("\n").trim() + "\n"
}
