import type { PluginInput } from "@opencode-ai/plugin"
import { sessionModelFromConfig } from "../gatehouse-config.ts"
import type { SessionRuntimeStatus } from "./status.ts"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

const healthCache = new Map<string, boolean>()

export async function opencodeHttpReady(input: PluginInput) {
  if (process.env.GATEHOUSE_USE_OPENCODE_HTTP === "0") return false
  if (!input.serverUrl) return false
  const key = input.serverUrl.origin
  const cached = healthCache.get(key)
  if (cached !== undefined) return cached
  const response = await fetch(new URL("/global/health", input.serverUrl), {
    signal: AbortSignal.timeout(800),
  }).catch(() => undefined)
  if (!response?.ok) {
    healthCache.set(key, false)
    return false
  }
  const body = (await response.json().catch(() => undefined)) as unknown
  const ready = isRecord(body) && body.healthy === true
  healthCache.set(key, ready)
  return ready
}

/** Route Gatehouse API calls through the live OpenCode listener, not the plugin in-process fetch. */
export function opencodeServerFetch(input: PluginInput) {
  const base = input.serverUrl
  return (request: RequestInfo | URL, init?: RequestInit) => {
    if (request instanceof Request) {
      const url = new URL(request.url, base)
      return fetch(new Request(url, request))
    }
    return fetch(new URL(request, base), init)
  }
}

function directoryUrl(input: PluginInput, path: string) {
  const url = new URL(path, input.serverUrl)
  url.searchParams.set("directory", input.directory)
  return url
}

export async function promptSessionHttp(
  input: PluginInput,
  sessionId: string,
  body: { agent?: string; text?: string; system?: string; noReply?: boolean; model?: string },
) {
  const modelRef = sessionModelFromConfig(body.model ?? "")
  const url = directoryUrl(input, `/session/${encodeURIComponent(sessionId)}/prompt_async`)
  const response = await opencodeServerFetch(input)(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        parts: [{ type: "text", text: body.text ?? "" }],
        ...(body.agent && { agent: body.agent }),
        ...(body.system && { system: body.system }),
        ...(body.noReply && { noReply: true }),
        ...(modelRef && { model: { providerID: modelRef.providerID, modelID: modelRef.id } }),
      }),
    }),
  )
  if (!response.ok) {
    throw new Error(`prompt_async failed (${response.status}) for session ${sessionId}`)
  }
}

export async function abortSessionHttp(input: PluginInput, sessionId: string) {
  const url = directoryUrl(input, `/session/${encodeURIComponent(sessionId)}/abort`)
  const response = await opencodeServerFetch(input)(
    new Request(url, { method: "POST", headers: { accept: "application/json" } }),
  )
  if (!response.ok) {
    throw new Error(`session abort failed (${response.status}) for session ${sessionId}`)
  }
}

export async function deleteSessionHttp(input: PluginInput, sessionId: string) {
  const url = directoryUrl(input, `/session/${encodeURIComponent(sessionId)}`)
  const response = await opencodeServerFetch(input)(
    new Request(url, { method: "DELETE", headers: { accept: "application/json" } }),
  )
  if (response.status === 404) return
  if (!response.ok) {
    throw new Error(`session delete failed (${response.status}) for session ${sessionId}`)
  }
}

export async function sessionStatusMapHttp(input: PluginInput) {
  const url = directoryUrl(input, "/session/status")
  const response = await opencodeServerFetch(input)(
    new Request(url, { headers: { accept: "application/json" } }),
  )
  if (!response.ok) throw new Error(`session status failed (${response.status})`)
  const body = (await response.json()) as unknown
  const data = isRecord(body) && isRecord(body.data) ? body.data : body
  if (!isRecord(data)) return new Map<string, SessionRuntimeStatus>()
  return new Map(
    Object.entries(data).map(([sessionId, value]) => {
      const type = isRecord(value) && typeof value.type === "string" ? value.type : "unknown"
      if (type === "idle" || type === "busy" || type === "retry") return [sessionId, type] as const
      return [sessionId, "unknown"] as const
    }),
  )
}

export async function replySessionPermissionHttp(
  input: PluginInput,
  params: { sessionId: string; requestId: string; reply: string },
) {
  const url = directoryUrl(
    input,
    `/session/${encodeURIComponent(params.sessionId)}/permissions/${encodeURIComponent(params.requestId)}`,
  )
  const response = await opencodeServerFetch(input)(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ response: params.reply }),
    }),
  )
  if (response.status === 404) {
    throw new Error(`permission request ${params.requestId} not found`, { cause: { status: 404 } })
  }
  if (!response.ok) {
    throw new Error(`session permission reply failed (${response.status}) for ${params.requestId}`)
  }
}
