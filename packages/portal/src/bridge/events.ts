import { eventsUrl } from "../api/project-directory.ts"
import { EVENTS_RECONNECT_MAX_MS, EVENTS_RECONNECT_MS } from "../portal/poll-intervals.ts"

/** Portal SSE events from /portal/events (agent.status, agent.chat — not raw OpenCode). */
export type PortalEvent =
  | { type: "agent.move"; agentId: string; x: number; y: number }
  | { type: "agent.status"; agentId: string; status: "idle" | "busy" | "research" }
  | { type: "agent.chat"; fromSpawnId: string; toSpawnId: string; text: string }
  | { type: "blog.publish"; postId: string; title?: string }
  | { type: "blog.unpublish"; postId: string; title?: string }
  | { type: "ping" }

function parsePortalEvent(message: MessageEvent<string>) {
  const raw = JSON.parse(message.data) as PortalEvent
  if (
    raw.type === "agent.move" ||
    raw.type === "agent.status" ||
    raw.type === "agent.chat" ||
    raw.type === "blog.publish" ||
    raw.type === "blog.unpublish" ||
    raw.type === "ping"
  ) {
    return raw
  }
  return undefined
}

function reconnectDelayMs(attempt: number) {
  const scaled = EVENTS_RECONNECT_MS * 2 ** attempt
  return Math.min(scaled, EVENTS_RECONNECT_MAX_MS)
}

export function connectPortalEvents(handlers: {
  onPortalEvent?: (event: PortalEvent) => void
  onStreamDisconnect?: () => void
  onStreamReconnect?: () => void
}) {
  let source: EventSource | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let reconnectAttempt = 0
  let closed = false
  let streamOpen = false
  let everConnected = false

  const connect = () => {
    if (closed) return
    source?.close()
    source = new EventSource(eventsUrl())
    source.onopen = () => {
      if (everConnected && !streamOpen) handlers.onStreamReconnect?.()
      everConnected = true
      streamOpen = true
      reconnectAttempt = 0
    }
    source.onmessage = (message) => {
      const event = parsePortalEvent(message)
      if (!event) return
      handlers.onPortalEvent?.(event)
    }
    source.onerror = () => {
      if (streamOpen) {
        streamOpen = false
        handlers.onStreamDisconnect?.()
      }
      source?.close()
      if (closed) return
      const delay = reconnectDelayMs(reconnectAttempt)
      reconnectAttempt += 1
      reconnectTimer = setTimeout(connect, delay)
    }
  }

  connect()

  return () => {
    closed = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    source?.close()
    source = undefined
  }
}
