export type TokenBreakdown = {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
  total: number
}

export type ToolNameMetrics = {
  total: number
  completed: number
  errors: number
  running: number
  pending: number
}

export type ToolAggregate = ToolNameMetrics & {
  by_name: Record<string, ToolNameMetrics>
}

export type SessionMetrics = {
  node_id: string
  session_id: string
  duration_ms?: number
  assistant_messages: number
  tokens: TokenBreakdown
  cost: number
  tools: ToolAggregate
}

export type SubtreeMetrics = {
  terminal_node_id: string
  scope: "subtree"
  node_ids: string[]
  session_count: number
  assistant_messages: number
  tokens: TokenBreakdown
  cost: number
  tools: ToolAggregate
  sessions: Array<{
    node_id: string
    session_id: string
    duration_ms?: number
    assistant_messages: number
    tools: ToolNameMetrics
  }>
}

export function emptyTokens(): TokenBreakdown {
  return {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
    total: 0,
  }
}

export function addTokens(target: TokenBreakdown, source: Partial<TokenBreakdown> | undefined) {
  if (!source) return target
  target.input += source.input ?? 0
  target.output += source.output ?? 0
  target.reasoning += source.reasoning ?? 0
  target.cache.read += source.cache?.read ?? 0
  target.cache.write += source.cache?.write ?? 0
  target.total = target.input + target.output + target.reasoning
  return target
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function toolMetrics(part: Record<string, unknown>, byName: Record<string, ToolNameMetrics>) {
  const tool = typeof part.tool === "string" ? part.tool : "unknown"
  const state = isRecord(part.state) ? part.state : {}
  const status = typeof state.status === "string" ? state.status : "unknown"
  const entry = byName[tool] ?? { total: 0, completed: 0, errors: 0, running: 0, pending: 0 }
  entry.total += 1
  if (status === "completed") entry.completed += 1
  if (status === "error") entry.errors += 1
  if (status === "running") entry.running += 1
  if (status === "pending") entry.pending += 1
  byName[tool] = entry
}

export function aggregateMessageParts(parts: Record<string, unknown>[]) {
  const byName: Record<string, ToolNameMetrics> = {}
  let tools = { total: 0, completed: 0, errors: 0, running: 0, pending: 0 }

  for (const part of parts) {
    if (part.type !== "tool") continue
    toolMetrics(part, byName)
    tools.total += 1
    const state = isRecord(part.state) ? part.state : {}
    const status = typeof state.status === "string" ? state.status : ""
    if (status === "completed") tools.completed += 1
    if (status === "error") tools.errors += 1
    if (status === "running") tools.running += 1
    if (status === "pending") tools.pending += 1
  }

  return { tools, byName }
}

export function aggregateAssistantMessages(messages: Array<{ info: Record<string, unknown>; parts?: Record<string, unknown>[] }>) {
  const tokens = emptyTokens()
  let cost = 0
  let assistant = 0

  for (const row of messages) {
    const info = row.info
    if (info.role !== "assistant") continue
    assistant += 1
    const messageTokens = isRecord(info.tokens) ? info.tokens : undefined
    addTokens(tokens, {
      input: typeof messageTokens?.input === "number" ? messageTokens.input : 0,
      output: typeof messageTokens?.output === "number" ? messageTokens.output : 0,
      reasoning: typeof messageTokens?.reasoning === "number" ? messageTokens.reasoning : 0,
      cache: {
        read: isRecord(messageTokens?.cache) && typeof messageTokens.cache.read === "number" ? messageTokens.cache.read : 0,
        write: isRecord(messageTokens?.cache) && typeof messageTokens.cache.write === "number" ? messageTokens.cache.write : 0,
      },
    })
    if (typeof info.cost === "number") cost += info.cost
  }

  return { assistant, tokens, cost }
}

function messageInfo(row: Record<string, unknown>) {
  return isRecord(row.info) ? row.info : row
}

function messageParts(row: Record<string, unknown>) {
  return Array.isArray(row.parts) ? row.parts.filter(isRecord) : []
}

export function aggregateSessionMetrics(input: {
  node_id: string
  session_id: string
  messages: Record<string, unknown>[]
  duration_ms?: number
}): SessionMetrics {
  const messageAgg = aggregateAssistantMessages(
    input.messages.map((row) => ({
      info: messageInfo(row),
    })),
  )
  const parts = input.messages.flatMap((row) => messageParts(row))
  const partAgg = aggregateMessageParts(parts)
  return {
    node_id: input.node_id,
    session_id: input.session_id,
    duration_ms: input.duration_ms,
    assistant_messages: messageAgg.assistant,
    tokens: messageAgg.tokens,
    cost: messageAgg.cost,
    tools: { ...partAgg.tools, by_name: partAgg.byName },
  }
}

export function mergeSessionMetrics(sessions: SessionMetrics[]): Omit<SubtreeMetrics, "terminal_node_id" | "scope" | "node_ids"> {
  const tokens = emptyTokens()
  let cost = 0
  let assistantMessages = 0
  const tools = { total: 0, completed: 0, errors: 0, running: 0, pending: 0 }
  const byName: Record<string, ToolNameMetrics> = {}

  for (const session of sessions) {
    addTokens(tokens, session.tokens)
    cost += session.cost
    assistantMessages += session.assistant_messages
    tools.total += session.tools.total
    tools.completed += session.tools.completed
    tools.errors += session.tools.errors
    tools.running += session.tools.running
    tools.pending += session.tools.pending
    for (const [name, metrics] of Object.entries(session.tools.by_name)) {
      const entry = byName[name] ?? { total: 0, completed: 0, errors: 0, running: 0, pending: 0 }
      entry.total += metrics.total
      entry.completed += metrics.completed
      entry.errors += metrics.errors
      entry.running += metrics.running
      entry.pending += metrics.pending
      byName[name] = entry
    }
  }

  return {
    session_count: sessions.length,
    assistant_messages: assistantMessages,
    tokens,
    cost,
    tools: { ...tools, by_name: byName },
    sessions: sessions.map((session) => ({
      node_id: session.node_id,
      session_id: session.session_id,
      duration_ms: session.duration_ms,
      assistant_messages: session.assistant_messages,
      tools: {
        total: session.tools.total,
        completed: session.tools.completed,
        errors: session.tools.errors,
        running: session.tools.running,
        pending: session.tools.pending,
      },
    })),
  }
}
