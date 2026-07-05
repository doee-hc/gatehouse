import { readNodeBriefRegistry } from "../execution/artifacts.ts"
import { gatehouseMessage } from "../i18n.ts"
import type { GatehouseLocale } from "../locale.ts"
import { dependsOnDeliverableNodes } from "./plan-graph.ts"
import type { OrchestrationPlan } from "./plan-types.ts"
import type { MissionTeamSpec } from "../missions/manifest/types.ts"
import type { NodeCompletion, OrchestrationState } from "./types.ts"
import { JsonSchemaValidationError, validateJsonSchema } from "./json-schema-validate.ts"

/** Accept JSON string or object for structured_output. */
export function parseStructuredOutputInput(raw: unknown): unknown | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === "string") {
    if (!raw.trim()) return undefined
    return JSON.parse(raw) as unknown
  }
  if (typeof raw === "object") return raw
  throw new Error("structured_output must be a JSON object or JSON string")
}

export function validateStructuredOutputAgainstBrief(
  structured: unknown | undefined,
  brief: { completion_schema?: Record<string, unknown> } | undefined,
) {
  if (!brief?.completion_schema) {
    if (structured !== undefined) {
      throw new Error("structured_output provided but node brief has no completion_schema")
    }
    return
  }
  if (structured === undefined) {
    throw new Error("structured_output is required when completion_schema is set on the node brief")
  }
  try {
    validateJsonSchema(structured, brief.completion_schema)
  } catch (error) {
    const message = error instanceof JsonSchemaValidationError ? error.message : String(error)
    throw new Error(`structured_output failed schema validation: ${message}`)
  }
}

export class DependsOnDeliverableValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly nodeId?: string,
  ) {
    super(message)
    this.name = "DependsOnDeliverableValidationError"
  }
}

export async function assertDependsOnDeliverableReady(
  directory: string,
  missionId: string,
  team: MissionTeamSpec,
  state: OrchestrationState,
  nodeIds: string[],
) {
  if (nodeIds.length === 0) return
  for (const nodeId of nodeIds) {
    if (!team.nodes[nodeId]) {
      throw new DependsOnDeliverableValidationError(
        "DEPENDS_ON_UNKNOWN_NODE",
        `dependsOn deliverable references unknown node: ${nodeId}`,
        nodeId,
      )
    }
    const node = state.nodes[nodeId]
    if (!node || node.status !== "done") {
      throw new DependsOnDeliverableValidationError(
        "DEPENDS_ON_NODE_NOT_DONE",
        `dependsOn node ${nodeId} is not done (status: ${node?.status ?? "missing"})`,
        nodeId,
      )
    }
    if (!node.completion?.summary?.trim()) {
      throw new DependsOnDeliverableValidationError(
        "DEPENDS_ON_MISSING_COMPLETION",
        `dependsOn node ${nodeId} has no completion summary; call gatehouse_execution_complete with summary first`,
        nodeId,
      )
    }
    const brief = await readNodeBriefRegistry(directory, missionId, nodeId)
    if (brief?.completion_schema && node.completion?.structured_output === undefined) {
      throw new DependsOnDeliverableValidationError(
        "DEPENDS_ON_MISSING_STRUCTURED",
        `dependsOn node ${nodeId} has no structured_output; call gatehouse_execution_complete with structured_output matching completion_schema`,
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
  return [
    `### ${gatehouseMessage("completion.summary.nodeHeader", locale, { node_id: nodeId })}`,
    "",
    completion.summary.trim(),
  ].join("\n")
}

export function formatDependsOnStructuredBlock(
  locale: GatehouseLocale,
  state: OrchestrationState,
  nodeIds: string[],
) {
  if (nodeIds.length === 0) return ""
  const sections = nodeIds.map((nodeId) => {
    const structured = state.nodes[nodeId]?.completion?.structured_output
    const header = `### ${gatehouseMessage("completion.structured.nodeHeader", locale, { node_id: nodeId })}`
    if (structured === undefined) {
      return `${header}\n\n(${gatehouseMessage("completion.structured.missing", locale)})`
    }
    return `${header}\n\n\`\`\`json\n${JSON.stringify(structured, null, 2)}\n\`\`\``
  })
  return [
    gatehouseMessage("completion.structured.header", locale),
    "",
    gatehouseMessage("completion.structured.hint", locale),
    "",
    ...sections,
  ].join("\n")
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
  _team: MissionTeamSpec,
  plan: OrchestrationPlan,
) {
  const terminalCompletion = state.nodes[terminalNodeId]?.completion
  const upstreamNodes = dependsOnDeliverableNodes(plan, terminalNodeId)
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
