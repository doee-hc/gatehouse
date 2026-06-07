import path from "node:path"
import { contextDir } from "../paths.ts"
import { gatehouseMessage } from "../i18n.ts"
import type { GatehouseLocale } from "../locale.ts"
import type { SubtreeMetrics } from "../metrics/aggregate.ts"
import { isRecord } from "../yaml.ts"

function parseSubtreeMetrics(value: unknown): SubtreeMetrics | undefined {
  if (!isRecord(value)) return undefined
  const root_node_id = typeof value.root_node_id === "string" ? value.root_node_id : undefined
  const node_ids = Array.isArray(value.node_ids)
    ? value.node_ids.filter((item): item is string => typeof item === "string")
    : undefined
  if (!root_node_id || !node_ids) return undefined
  const tokens = isRecord(value.tokens)
    ? {
        input: Number(value.tokens.input ?? 0),
        output: Number(value.tokens.output ?? 0),
        reasoning: Number(value.tokens.reasoning ?? 0),
        cache: {
          read: Number(isRecord(value.tokens.cache) ? value.tokens.cache.read ?? 0 : 0),
          write: Number(isRecord(value.tokens.cache) ? value.tokens.cache.write ?? 0 : 0),
        },
        total: Number(value.tokens.total ?? 0),
      }
    : { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 }, total: 0 }
  const tools = isRecord(value.tools)
    ? {
        total: Number(value.tools.total ?? 0),
        completed: Number(value.tools.completed ?? 0),
        errors: Number(value.tools.errors ?? 0),
        running: Number(value.tools.running ?? 0),
        pending: Number(value.tools.pending ?? 0),
        by_name: {},
      }
    : { total: 0, completed: 0, errors: 0, running: 0, pending: 0, by_name: {} }
  return {
    root_node_id,
    scope: "subtree",
    node_ids,
    session_count: Number(value.session_count ?? node_ids.length),
    assistant_messages: Number(value.assistant_messages ?? 0),
    tokens,
    cost: Number(value.cost ?? 0),
    tools,
    sessions: [],
  }
}

export async function readRetroSubtreeMetrics(projectDirectory: string, missionId: string, nodeId: string) {
  const metricsPath = path.join(contextDir(projectDirectory, missionId), "subtree-metrics.json")
  const file = Bun.file(metricsPath)
  if (!(await file.exists())) return undefined
  const raw = JSON.parse(await file.text())
  if (!isRecord(raw) || !isRecord(raw.retro_nodes)) return undefined
  return parseSubtreeMetrics(raw.retro_nodes[nodeId])
}

export function formatRetroKickoffContext(
  input: {
    missionId: string
    nodeId: string
    retroOrder: string[]
    subtree?: SubtreeMetrics
    locale: GatehouseLocale
  },
) {
  const lines = [gatehouseMessage("retro.kickoff.contextHeader", input.locale)]
  lines.push(
    gatehouseMessage("retro.kickoff.scopeNodes", input.locale, {
      list: input.subtree?.node_ids.join(", ") ?? input.nodeId,
    }),
  )
  const orderIndex = input.retroOrder.indexOf(input.nodeId)
  if (orderIndex >= 0) {
    lines.push(
      gatehouseMessage("retro.kickoff.order", input.locale, {
        position: String(orderIndex + 1),
        total: String(input.retroOrder.length),
      }),
    )
  }
  if (input.subtree) {
    lines.push(
      gatehouseMessage("retro.kickoff.metricsSummary", input.locale, {
        sessions: String(input.subtree.session_count),
        assistant_messages: String(input.subtree.assistant_messages),
        tokens_total: String(input.subtree.tokens.total),
        tool_calls: String(input.subtree.tools.total),
        tool_errors: String(input.subtree.tools.errors),
      }),
    )
  }
  lines.push("")
  lines.push(gatehouseMessage("retro.kickoff.contextPaths", input.locale, { mission_id: input.missionId }))
  return lines.join("\n")
}
