import { gatehouseLog } from "../log.ts"
import { DEFAULT_PORTAL_DISPLAY_PORT } from "./defaults.ts"
import { readDisplayPortalApiFromRuntime } from "./ports.ts"
import { portalInternalToken, validatePortalInternalToken } from "./security.ts"

export type PortalChatEvent = {
  type: "agent.chat"
  fromSpawnId: string
  toSpawnId: string
  text: string
}

export type PortalAgentStatusEvent = {
  type: "agent.status"
  agentId: string
  status: "idle" | "busy" | "research"
}

export type PortalBlogPublishEvent = {
  type: "blog.publish"
  postId: string
  title?: string
}

export type PortalBlogUnpublishEvent = {
  type: "blog.unpublish"
  postId: string
  title?: string
}

export type PortalInjectedEvent =
  | PortalChatEvent
  | PortalAgentStatusEvent
  | PortalBlogPublishEvent
  | PortalBlogUnpublishEvent
  | { type: "ping" }

const listeners = new Set<(event: PortalInjectedEvent) => void>()
let inProcessDelivery = false

function portalApiUrl() {
  if (process.env.GATEHOUSE_PORTAL_API) return process.env.GATEHOUSE_PORTAL_API
  const projectDirectory = process.env.GATEHOUSE_PROJECT_DIR?.trim()
  if (projectDirectory) {
    const fromRuntime = readDisplayPortalApiFromRuntime(projectDirectory)
    if (fromRuntime) return fromRuntime
  }
  if (process.env.GATEHOUSE_PORTAL_URL) return process.env.GATEHOUSE_PORTAL_URL.replace(/\/$/, "")
  const port = process.env.GATEHOUSE_PORTAL_PORT ?? String(DEFAULT_PORTAL_DISPLAY_PORT)
  return `http://127.0.0.1:${port}`
}

export function setPortalInProcessDelivery(enabled: boolean) {
  inProcessDelivery = enabled
}

export function isPortalInProcessDelivery() {
  return inProcessDelivery
}

async function postPortalEvent(event: PortalInjectedEvent) {
  await fetch(`${portalApiUrl()}/portal/api/internal/event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Gatehouse-Portal-Internal-Token": portalInternalToken(),
    },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(5000),
  })
}

export function emitPortalEvent(event: PortalInjectedEvent) {
  if (inProcessDelivery) {
    deliverPortalEvent(event)
    return
  }

  void postPortalEvent(event).catch((error) => {
    gatehouseLog(
      "warn",
      `[gatehouse/portal] emitPortalEvent failed: ${error instanceof Error ? error.message : error}`,
      { title: "Portal" },
    )
  })
}

export function subscribePortalEvents(listener: (event: PortalInjectedEvent) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function deliverPortalEvent(event: PortalInjectedEvent) {
  for (const listener of listeners) listener(event)
}

export function isSupportedPortalInjectedEvent(event: PortalInjectedEvent) {
  return (
    event.type === "agent.chat" ||
    event.type === "agent.status" ||
    event.type === "blog.publish" ||
    event.type === "blog.unpublish" ||
    event.type === "ping"
  )
}

export function handlePortalInternalEventRequest(request: Request) {
  if (!validatePortalInternalToken(request)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    })
  }
  return undefined
}
