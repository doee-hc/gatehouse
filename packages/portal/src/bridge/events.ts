import { eventsUrl } from "../api/project-directory.ts"
import { EVENTS_RECONNECT_MS } from "../portal/poll-intervals.ts"

/** Portal SSE events from /portal/events (agent.status, agent.chat — not raw OpenCode). */
export type PortalEvent =
  | { type: "agent.move"; agentId: string; x: number; y: number }
  | { type: "agent.status"; agentId: string; status: "idle" | "busy" | "research" }
  | { type: "agent.chat"; fromSpawnId: string; toSpawnId: string; text: string }
  | { type: "ping" }

function parsePortalEvent(message: MessageEvent<string>) {
  const raw = JSON.parse(message.data) as PortalEvent
  if (
    raw.type === "agent.move" ||
    raw.type === "agent.status" ||
    raw.type === "agent.chat" ||
    raw.type === "ping"
  ) {
    return raw
  }
  return undefined
}

export function connectPortalEvents(handlers: { onPortalEvent?: (event: PortalEvent) => void }) {
  let source: EventSource | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let closed = false

  const connect = () => {
    if (closed) return
    source?.close()
    source = new EventSource(eventsUrl())
    source.onmessage = (message) => {
      const event = parsePortalEvent(message)
      if (!event) return
      handlers.onPortalEvent?.(event)
    }
    source.onerror = () => {
      source?.close()
      if (closed) return
      reconnectTimer = setTimeout(connect, EVENTS_RECONNECT_MS)
    }
  }

  connect()

  return () => {
    closed = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    source?.close()
  }
}
