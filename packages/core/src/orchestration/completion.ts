import { gatehouseMessage } from "../i18n.ts"
import type { GatehouseLocale } from "../locale.ts"
import { dependsOnSummaryNodes } from "./plan-graph.ts"
import type { OrchestrationPlan } from "./plan-types.ts"
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

export class DependsOnSummaryValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly nodeId?: string,
  ) {
    super(message)
    this.name = "DependsOnSummaryValidationError"
  }
}

export function assertDependsOnSummaryReady(
  team: TeamSpec,
  state: OrchestrationState,
  nodeIds: string[],
) {
  if (nodeIds.length === 0) return
  for (const nodeId of nodeIds) {
    if (!team.nodes[nodeId]) {
      throw new DependsOnSummaryValidationError(
        "DEPENDS_ON_UNKNOWN_NODE",
        `dependsOn summary references unknown node: ${nodeId}`,
        nodeId,
      )
    }
    const node = state.nodes[nodeId]
    if (!node || node.status !== "done") {
      throw new DependsOnSummaryValidationError(
        "DEPENDS_ON_NODE_NOT_DONE",
        `dependsOn node ${nodeId} is not done (status: ${node?.status ?? "missing"})`,
        nodeId,
      )
    }
    if (!node.completion?.summary?.trim()) {
      throw new DependsOnSummaryValidationError(
        "DEPENDS_ON_MISSING_COMPLETION",
        `dependsOn node ${nodeId} has no structured completion; call gatehouse_execution_complete with summary first`,
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
    `### ${gatehouseMessage("completion.summary.nodeHeader", locale, { node_id: nodeId })}`,
    "",
    completion.summary.trim(),
  ]
  if (completion.artifacts?.length) {
    lines.push("", gatehouseMessage("completion.summary.artifactsHeader", locale))
    for (const artifact of completion.artifacts) {
      lines.push(`- \`${artifact.path}\` — ${artifact.description}`)
    }
  }
  const risks = completion.risks?.filter((item) => item.trim())
  if (risks?.length) {
    lines.push("", gatehouseMessage("completion.summary.risksHeader", locale))
    for (const risk of risks) lines.push(`- ${risk}`)
  }
  return lines.join("\n")
}

export function formatDependsOnSummaryBlock(
  locale: GatehouseLocale,
  state: OrchestrationState,
  nodeIds: string[],
) {
  if (nodeIds.length === 0) return ""
  const sections = nodeIds.map((nodeId) => {
    const completion = state.nodes[nodeId]?.completion
    if (!completion) {
      return `### ${nodeId}\n\n(${gatehouseMessage("completion.summary.missing", locale)})`
    }
    return formatNodeCompletionSection(locale, nodeId, completion)
  })
  return [
    gatehouseMessage("completion.summary.header", locale),
    "",
    gatehouseMessage("completion.summary.hint", locale),
    "",
    ...sections,
  ].join("\n")
}

export function synthesizeTerminalDeliveryMarkdown(
  locale: GatehouseLocale,
  missionId: string,
  terminalNodeId: string,
  state: OrchestrationState,
  _team: TeamSpec,
  plan: OrchestrationPlan,
) {
  const terminalCompletion = state.nodes[terminalNodeId]?.completion
  const upstreamNodes = dependsOnSummaryNodes(plan, terminalNodeId)
    .filter((nodeId) => state.nodes[nodeId]?.status === "done" && state.nodes[nodeId]?.completion)

  const lines = [
    `# ${gatehouseMessage("completion.terminalDelivery.title", locale, { mission_id: missionId })}`,
    "",
    gatehouseMessage("completion.terminalDelivery.generated", locale),
    "",
  ]

  if (terminalCompletion?.summary?.trim()) {
    lines.push(
      `## ${gatehouseMessage("completion.terminalDelivery.terminalSummary", locale)}`,
      "",
      terminalCompletion.summary.trim(),
      "",
    )
    if (terminalCompletion.artifacts?.length) {
      lines.push(gatehouseMessage("completion.terminalDelivery.terminalArtifacts", locale))
      for (const artifact of terminalCompletion.artifacts) {
        lines.push(`- \`${artifact.path}\` — ${artifact.description}`)
      }
      lines.push("")
    }
  }

  if (upstreamNodes.length > 0) {
    lines.push(`## ${gatehouseMessage("completion.terminalDelivery.upstreamSummaries", locale)}`, "")
    for (const upstreamId of upstreamNodes) {
      const completion = state.nodes[upstreamId]?.completion
      if (!completion) continue
      lines.push(formatNodeCompletionSection(locale, upstreamId, completion), "")
    }
  }

  return lines.join("\n").trim() + "\n"
}
