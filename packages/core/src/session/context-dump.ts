import path from "node:path"
import { mkdir } from "node:fs/promises"
import { contextDir, contextIndexRelPath, nodeContextDir, nodeContextRelDir } from "../paths.ts"
import { aggregateSessionMetrics, mergeSessionMetrics, type SessionMetrics } from "../metrics/aggregate.ts"
import { managerRetroOrder } from "../tree/parse.ts"
import type { TreeManifest, TreeNode } from "../tree/types.ts"
import type { GatehouseClient } from "./client.ts"
import { sessionDetail, sessionDurationMs, sessionMessages } from "./client.ts"
import { collectSubtreeNodeIds } from "../tools/list-members.ts"

export type MessageKind =
  | "user"
  | "gatehouse"
  | "system_inject"
  | "synthetic"
  | "compaction_marker"
  | "summary"
  | "assistant"
  | "unknown"

export type NodeContextDump = {
  mission_id: string
  node_id: string
  session_id: string
  rel_dir: string
  messages_path: string
  timeline_path: string
  metrics_path: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function messageInfo(row: Record<string, unknown>) {
  return isRecord(row.info) ? row.info : row
}

function messageParts(row: Record<string, unknown>) {
  return Array.isArray(row.parts) ? row.parts.filter(isRecord) : []
}

function messageId(row: Record<string, unknown>) {
  const info = messageInfo(row)
  return typeof info.id === "string" ? info.id : undefined
}

function messageAtMs(row: Record<string, unknown>) {
  const info = messageInfo(row)
  const time = isRecord(info.time) ? info.time : undefined
  return typeof time?.created === "number" ? time.created : undefined
}

function collectText(parts: Record<string, unknown>[]) {
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n")
    .trim()
}

export function classifyMessageKind(row: Record<string, unknown>): MessageKind {
  const info = messageInfo(row)
  const role = info.role
  const parts = messageParts(row)

  if (role === "assistant") {
    if (info.summary === true || info.agent === "compaction") return "summary"
    return "assistant"
  }

  if (role !== "user") return "unknown"

  const hasCompaction = parts.some((part) => part.type === "compaction")
  const text = collectText(parts)
  if (text.includes("[Gatehouse 消息") || text.includes("[Gatehouse message")) return "gatehouse"
  if (typeof info.system === "string" && info.system.length > 0) return "system_inject"
  const synthetic = parts.some(
    (part) =>
      part.type === "text" &&
      (part.synthetic === true ||
        (isRecord(part.metadata) && part.metadata.compaction_continue === true)),
  )
  if (synthetic) return "synthetic"
  if (hasCompaction && !text) return "compaction_marker"
  if (hasCompaction) return "compaction_marker"
  return "user"
}

function toolParts(row: Record<string, unknown>) {
  return messageParts(row).filter((part) => part.type === "tool")
}

function toolState(part: Record<string, unknown>) {
  return isRecord(part.state) ? part.state : undefined
}

function toolName(part: Record<string, unknown>) {
  return typeof part.tool === "string" ? part.tool : "unknown"
}

function toolStatus(part: Record<string, unknown>) {
  const state = toolState(part)
  return typeof state?.status === "string" ? state.status : "unknown"
}

function toolInput(part: Record<string, unknown>) {
  const state = toolState(part)
  return isRecord(state?.input) ? state.input : undefined
}

function toolOutput(part: Record<string, unknown>) {
  const state = toolState(part)
  if (typeof state?.output === "string") return state.output
  if (typeof state?.error === "string") return state.error
  return undefined
}

function assistantTokens(info: Record<string, unknown>) {
  const tokens = isRecord(info.tokens) ? info.tokens : undefined
  const input = typeof tokens?.input === "number" ? tokens.input : 0
  const output = typeof tokens?.output === "number" ? tokens.output : 0
  const reasoning = typeof tokens?.reasoning === "number" ? tokens.reasoning : 0
  return input + output + reasoning
}

function formatIso(at_ms: number | undefined) {
  if (at_ms === undefined) return "unknown-time"
  return new Date(at_ms).toISOString()
}

function timelineToolLine(part: Record<string, unknown>) {
  const name = toolName(part)
  const status = toolStatus(part)
  const inputValue = toolInput(part)
  const recipient =
    typeof inputValue?.recipient === "string"
      ? inputValue.recipient
      : typeof inputValue?.node_id === "string"
        ? inputValue.node_id
        : undefined
  const state = toolState(part)
  const time = isRecord(state?.time) ? state.time : undefined
  const end = typeof time?.end === "number" ? time.end : undefined
  const start = typeof time?.start === "number" ? time.start : undefined
  const duration = end !== undefined && start !== undefined ? end - start : undefined
  const bits = [`tool=${name}`, `status=${status}`]
  if (recipient) bits.push(`recipient=${recipient}`)
  if (duration !== undefined) bits.push(`duration_ms=${duration}`)
  if (typeof time?.compacted === "number") bits.push(`output_compacted=${time.compacted}`)
  return bits.join(" · ")
}

export function formatTimelineMarkdown(input: {
  missionId: string
  nodeId: string
  sessionId: string
  messages: Record<string, unknown>[]
}) {
  const lines = [
    `# timeline · ${input.missionId} · ${input.nodeId}`,
    "",
    `session_id: ${input.sessionId}`,
    "",
    "Each block is grep-friendly. Kinds: user | gatehouse | system_inject | synthetic | compaction_marker | summary | assistant",
    "",
  ]

  input.messages.forEach((row, index) => {
    const info = messageInfo(row)
    const id = messageId(row) ?? `row-${index + 1}`
    const at_ms = messageAtMs(row)
    const kind = classifyMessageKind(row)
    const parts = messageParts(row)
    const tokens = info.role === "assistant" ? assistantTokens(info) : undefined
    const headerBits = [
      `[${String(index + 1).padStart(4, "0")}]`,
      formatIso(at_ms),
      `kind=${kind}`,
      `id=${id}`,
    ]
    if (tokens !== undefined && tokens > 0) headerBits.push(`tokens=${tokens}`)
    lines.push(`## ${headerBits.join(" · ")}`)
    lines.push("")

    if (kind === "compaction_marker") {
      for (const part of parts) {
        if (part.type !== "compaction") continue
        lines.push(
          `- compaction auto=${String(part.auto === true)} overflow=${String(part.overflow === true)} tail_start_id=${typeof part.tail_start_id === "string" ? part.tail_start_id : "none"}`,
        )
      }
    }

    const text = collectText(parts)
    if (text) {
      lines.push("```")
      lines.push(text)
      lines.push("```")
      lines.push("")
    }

    for (const part of toolParts(row)) {
      lines.push(`- ${timelineToolLine(part)}`)
      const output = toolOutput(part)
      if (output && (toolName(part) === "todowrite" || toolName(part) === "gatehouse_send_message")) {
        lines.push("  ```json")
        lines.push(output.split("\n").map((line) => `  ${line}`).join("\n").trimStart())
        lines.push("  ```")
      }
    }
    lines.push("")
  })

  return lines.join("\n").trimEnd() + "\n"
}

export async function dumpNodeContext(input: {
  client: GatehouseClient
  projectDirectory: string
  missionId: string
  nodeId: string
  node: TreeNode
}) {
  const [messages, detail] = await Promise.all([
    sessionMessages(input.client, input.projectDirectory, input.node.session_id),
    sessionDetail(input.client, input.projectDirectory, input.node.session_id),
  ])

  const relDir = nodeContextRelDir(input.missionId, input.nodeId)
  const absDir = nodeContextDir(input.projectDirectory, input.missionId, input.nodeId)
  await mkdir(absDir, { recursive: true })
  await Bun.write(
    path.join(absDir, "messages.json"),
    JSON.stringify(
      {
        mission_id: input.missionId,
        node_id: input.nodeId,
        session_id: input.node.session_id,
        parent: input.node.parent,
        dumped_at: new Date().toISOString(),
        duration_ms: sessionDurationMs(detail),
        message_count: messages.length,
        messages,
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(absDir, "timeline.md"),
    formatTimelineMarkdown({
      missionId: input.missionId,
      nodeId: input.nodeId,
      sessionId: input.node.session_id,
      messages,
    }),
  )

  const duration_ms = sessionDurationMs(detail)
  const metrics = aggregateSessionMetrics({
    node_id: input.nodeId,
    session_id: input.node.session_id,
    messages,
    duration_ms,
  })
  const metricsPath = path.join(relDir, "metrics.json")
  await Bun.write(
    path.join(absDir, "metrics.json"),
    JSON.stringify(
      {
        mission_id: input.missionId,
        dumped_at: new Date().toISOString(),
        ...metrics,
      },
      null,
      2,
    ),
  )

  return {
    mission_id: input.missionId,
    node_id: input.nodeId,
    session_id: input.node.session_id,
    rel_dir: relDir,
    messages_path: path.join(relDir, "messages.json"),
    timeline_path: path.join(relDir, "timeline.md"),
    metrics_path: metricsPath,
    metrics,
  }
}

export async function dumpMissionContext(input: {
  client: GatehouseClient
  projectDirectory: string
  manifest: TreeManifest
}) {
  const entries = await Promise.all(
    Object.entries(input.manifest.nodes).map(([nodeId, node]) =>
      dumpNodeContext({
        client: input.client,
        projectDirectory: input.projectDirectory,
        missionId: input.manifest.mission_id,
        nodeId,
        node,
      }),
    ),
  )

  const metricsByNode = Object.fromEntries(
    entries.map((entry) => [entry.node_id, entry.metrics satisfies SessionMetrics]),
  ) as Record<string, SessionMetrics>

  const retroOrder = managerRetroOrder(input.manifest)
  const retroNodes = Object.fromEntries(
    retroOrder.map((nodeId) => {
      const nodeIds = collectSubtreeNodeIds(input.manifest, nodeId, true)
      const sessions = nodeIds.map((id) => metricsByNode[id]).filter((metrics): metrics is SessionMetrics => Boolean(metrics))
      return [
        nodeId,
        {
          root_node_id: nodeId,
          scope: "subtree" as const,
          node_ids: nodeIds,
          ...mergeSessionMetrics(sessions),
        },
      ]
    }),
  )

  const contextRoot = contextDir(input.projectDirectory, input.manifest.mission_id)
  const subtreeMetricsRel = path.join(
    ".gatehouse",
    "architect",
    "trees",
    input.manifest.mission_id,
    "context",
    "subtree-metrics.json",
  )
  await mkdir(contextRoot, { recursive: true })
  await Bun.write(
    path.join(contextRoot, "subtree-metrics.json"),
    JSON.stringify(
      {
        mission_id: input.manifest.mission_id,
        dumped_at: new Date().toISOString(),
        retro_order: retroOrder,
        retro_nodes: retroNodes,
      },
      null,
      2,
    ),
  )

  const nodeEntries = entries.map(({ metrics: _metrics, ...entry }) => entry satisfies NodeContextDump)
  const contextIndexPath = path.join(contextRoot, "index.json")
  await Bun.write(
    contextIndexPath,
    JSON.stringify(
      {
        mission_id: input.manifest.mission_id,
        dumped_at: new Date().toISOString(),
        note: "执行上下文快照：messages/timeline/metrics 已落盘；语义特征提取请 retro coord 自制脚本或复用 skills/retro-toolkit/",
        subtree_metrics_path: subtreeMetricsRel,
        retro_order: retroOrder,
        nodes: nodeEntries,
      },
      null,
      2,
    ),
  )

  return {
    mission_id: input.manifest.mission_id,
    dumped: entries.length,
    nodes: nodeEntries,
    index_path: contextIndexRelPath(input.manifest.mission_id),
    subtree_metrics_path: subtreeMetricsRel,
    retro_order: retroOrder,
  }
}
