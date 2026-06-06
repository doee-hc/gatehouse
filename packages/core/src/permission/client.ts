import type { PluginInput } from "@opencode-ai/plugin"
import { opencodeHttpReady, opencodeServerFetch, replySessionPermissionHttp } from "../session/http.ts"
import { directoryQuery, sessionDirectory, sessionWorkspaceId, type GatehouseClient } from "../session/client.ts"
import type { InspectorReply } from "../arbiter/types.ts"

type PermissionReplyRoute = {
  directory?: string
  workspace?: string
  sessionID?: string
}

function routeLabel(route: PermissionReplyRoute, fallback: string) {
  if (route.sessionID && !route.workspace && !route.directory) return `session:${route.sessionID}`
  if (route.workspace) return `workspace:${route.workspace}`
  if (route.directory) return `directory:${route.directory}`
  if (route.sessionID) return `session-query:${route.sessionID}`
  return fallback
}

async function invokeSessionPermissionReply(
  input: PluginInput,
  params: {
    requestId: string
    sessionId: string
    reply: InspectorReply
  },
) {
  if (await opencodeHttpReady(input)) {
    try {
      await replySessionPermissionHttp(input, {
        sessionId: params.sessionId,
        requestId: params.requestId,
        reply: params.reply,
      })
      return true
    } catch (error) {
      if (permissionReplyNotFound(error)) return false
      throw error
    }
  }
  const client = input.client as unknown as PermissionSdkClient
  if (client.permission?.respond) {
    await client.permission.respond(
      {
        sessionID: params.sessionId,
        permissionID: params.requestId,
        response: params.reply,
      },
      { throwOnError: true },
    )
    return true
  }
  if (typeof client.postSessionIdPermissionsPermissionId === "function") {
    await client.postSessionIdPermissionsPermissionId({
      path: { id: params.sessionId, permissionID: params.requestId },
      body: { response: params.reply },
    })
    return true
  }
  return false
}

async function invokePermissionReplyFetch(
  input: PluginInput,
  route: PermissionReplyRoute,
  params: {
    requestId: string
    reply: InspectorReply
    message?: string
  },
) {
  const body = {
    reply: params.reply,
    ...(params.reply === "reject" && params.message ? { message: params.message } : {}),
  }
  const fetchFn = opencodeServerFetch(input)
  const url = new URL(`permission/${params.requestId}/reply`, input.serverUrl)
  if (route.sessionID) url.searchParams.set("sessionID", route.sessionID)
  if (route.workspace) url.searchParams.set("workspace", route.workspace)
  if (route.directory) url.searchParams.set("directory", route.directory)
  const request = new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  })
  const response = await fetchFn(request)
  if (response.status === 404) {
    throw new Error(`permission request ${params.requestId} not found`, { cause: { status: 404 } })
  }
  if (!response.ok) {
    throw new Error(`permission reply failed (${response.status}) for ${routeLabel(route, input.directory)}`)
  }
}

type PermissionSdkClient = {
  permission?: {
    reply(
      input: {
        requestID: string
        directory?: string
        workspace?: string
        reply?: InspectorReply
        message?: string
      },
      options?: { throwOnError?: boolean },
    ): Promise<{ data?: unknown; error?: unknown; response?: Response }>
    respond?(
      input: {
        sessionID: string
        permissionID: string
        directory?: string
        workspace?: string
        response?: InspectorReply
      },
      options?: { throwOnError?: boolean },
    ): Promise<{ data?: unknown; error?: unknown; response?: Response }>
    list(input?: { directory?: string; workspace?: string }): Promise<{ data?: unknown[] }>
  }
  postSessionIdPermissionsPermissionId?(input: {
    path: { id: string; permissionID: string }
    query?: { directory?: string }
    body?: { response: InspectorReply }
  }): Promise<unknown>
  _client?: { client?: { fetch?: typeof fetch } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function permissionEntries(response: unknown) {
  if (Array.isArray(response)) return response
  if (!isRecord(response)) return []
  if (Array.isArray(response.data)) return response.data
  return []
}

function permissionId(entry: unknown) {
  return isRecord(entry) && typeof entry.id === "string" ? entry.id : undefined
}

export function serverPendingRequestIds(input: PluginInput, directory = input.directory, sessionId?: string) {
  return listPermissions(input, directory, sessionId).then((listed) => {
    const ids = permissionEntries(listed)
      .map((entry) => permissionId(entry))
      .filter((id): id is string => typeof id === "string")
    return new Set(ids)
  })
}

function usableDirectoryHint(directory: string) {
  const trimmed = directory.trim()
  if (!trimmed) return false
  if (trimmed === "/" || trimmed === "\\") return false
  return true
}

export function permissionReplyStale(error: unknown) {
  if (!(error instanceof Error)) return false
  return error.message.includes("not pending in OpenCode")
}

function uniqueDirectories(hints: string[]) {
  return [
    ...new Set(
      hints
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim()),
    ),
  ]
}

function permissionReplyNotFound(error: unknown) {
  if (error instanceof Error) {
    const cause = error.cause
    if (isRecord(cause) && cause.status === 404) return true
    const message = error.message.toLowerCase()
    if (message.includes("not found") || message.includes("not pending")) return true
  }
  if (isRecord(error) && isRecord(error.response) && error.response.status === 404) return true
  return false
}

async function listProjectWorkspaces(input: PluginInput) {
  if (!(await opencodeHttpReady(input))) return []
  const fetchFn = opencodeServerFetch(input)
  const url = new URL("experimental/workspace", input.serverUrl)
  url.searchParams.set("directory", input.directory)
  const response = await fetchFn(
    new Request(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(1500) }),
  ).catch(() => undefined)
  if (!response) return []
  if (!response.ok) return []
  const data = await response.json()
  if (!Array.isArray(data)) return []
  return data.flatMap((item) => (isRecord(item) && typeof item.id === "string" ? [item.id] : []))
}

async function workspaceCandidates(input: PluginInput, sessionId: string) {
  const client = input.client as GatehouseClient
  const ids = new Set<string>()
  const fromSession = await sessionWorkspaceId(client, input.directory, sessionId)
  if (fromSession) ids.add(fromSession)
  for (const workspace of await listProjectWorkspaces(input)) ids.add(workspace)
  return [...ids]
}

async function callPermissionList(input: PluginInput, route: PermissionReplyRoute, sessionId?: string) {
  const client = input.client as unknown as PermissionSdkClient
  if (client.permission?.list) {
    return client.permission.list({
      ...(route.directory ? { directory: route.directory } : {}),
      ...(route.workspace ? { workspace: route.workspace } : {}),
    })
  }
  const fetchFn = opencodeServerFetch(input)
  const url = new URL("permission", input.serverUrl)
  if (route.sessionID) url.searchParams.set("sessionID", route.sessionID)
  if (route.workspace) url.searchParams.set("workspace", route.workspace)
  if (route.directory) url.searchParams.set("directory", route.directory)
  if (sessionId && !route.sessionID) url.searchParams.set("sessionID", sessionId)
  const request = new Request(url, { headers: { accept: "application/json" } })
  const response = await fetchFn(request)
  if (!response.ok) {
    const target = route.workspace ?? route.directory ?? input.directory
    throw new Error(`permission.list failed (${response.status}) for ${target}`)
  }
  const data = await response.json()
  return { data: Array.isArray(data) ? data : [] }
}

export async function listPermissions(input: PluginInput, directory = input.directory, sessionId?: string) {
  return callPermissionList(input, { directory }, sessionId).catch(() => ({ data: [] as unknown[] }))
}

async function listPermissionsStrict(input: PluginInput, route: PermissionReplyRoute, sessionId?: string) {
  return callPermissionList(input, route, sessionId)
}

async function directoryCandidates(
  input: PluginInput,
  params: { sessionId: string; directoryHints: string[] },
) {
  const client = input.client as GatehouseClient
  const candidates = uniqueDirectories([
    ...params.directoryHints,
    input.directory,
    input.worktree,
  ])
  const expanded = [...candidates]
  for (const directory of candidates) {
    const resolved = await sessionDirectory(client, directory, params.sessionId)
    if (!usableDirectoryHint(resolved)) continue
    if (!expanded.includes(resolved)) expanded.push(resolved)
  }
  return uniqueDirectories(expanded.filter(usableDirectoryHint))
}

async function invokePermissionReply(
  input: PluginInput,
  route: PermissionReplyRoute,
  params: {
    requestId: string
    sessionId: string
    reply: InspectorReply
    message?: string
  },
) {
  if (await opencodeHttpReady(input)) {
    await invokePermissionReplyFetch(input, route, params)
    return
  }
  const replyParams = {
    requestID: params.requestId,
    reply: params.reply,
    ...(route.directory ? { directory: route.directory } : {}),
    ...(route.workspace ? { workspace: route.workspace } : {}),
    ...(params.reply === "reject" && params.message ? { message: params.message } : {}),
  }
  const client = input.client as unknown as PermissionSdkClient
  if (client.permission?.reply) {
    await client.permission.reply(replyParams, { throwOnError: true })
    return
  }
  if (typeof client.postSessionIdPermissionsPermissionId === "function" && route.directory) {
    await client.postSessionIdPermissionsPermissionId({
      ...directoryQuery(route.directory),
      path: { id: params.sessionId, permissionID: params.requestId },
      body: { response: params.reply },
    })
    return
  }
  if (await opencodeHttpReady(input)) {
    await invokePermissionReplyFetch(input, route, params)
  }
}

async function assertPermissionResolved(
  input: PluginInput,
  route: PermissionReplyRoute,
  requestId: string,
  sessionId: string,
) {
  const listed = await listPermissionsStrict(input, route, sessionId).catch(() => undefined)
  if (!listed) return
  if (permissionEntries(listed).some((entry) => permissionId(entry) === requestId)) {
    throw new Error(`permission reply did not resolve request ${requestId}; ask UI may still be waiting`)
  }
}

export async function replyPermission(
  input: PluginInput,
  params: {
    requestId: string
    sessionId: string
    reply: InspectorReply
    message?: string
    directoryHints?: string[]
  },
) {
  let lastError: unknown
  const tried: string[] = []

  try {
    if (await invokeSessionPermissionReply(input, params)) {
      tried.push(`session:${params.sessionId}`)
      await assertPermissionResolved(input, { sessionID: params.sessionId }, params.requestId, params.sessionId)
      return
    }
  } catch (error) {
    lastError = error
    if (!permissionReplyNotFound(error)) throw error
  }

  const workspaces = await workspaceCandidates(input, params.sessionId)
  const directories = await directoryCandidates(input, {
    sessionId: params.sessionId,
    directoryHints: params.directoryHints ?? [input.directory],
  })
  const routes: PermissionReplyRoute[] = [
    ...(params.reply === "reject" && params.message ? [{ sessionID: params.sessionId }] : []),
    ...workspaces.map((workspace) => ({ workspace })),
    ...directories.map((directory) => ({ directory })),
    { sessionID: params.sessionId },
  ]
  const seen = new Set<string>()
  for (const route of routes) {
    const label = routeLabel(route, input.directory)
    if (seen.has(label)) continue
    seen.add(label)
    tried.push(label)
    try {
      await invokePermissionReply(input, route, params)
      await assertPermissionResolved(input, route, params.requestId, params.sessionId)
      return
    } catch (error) {
      lastError = error
      if (permissionReplyNotFound(error)) continue
      throw error
    }
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : ""
  throw new Error(
    `permission request ${params.requestId} not pending in OpenCode (routes tried: ${tried.join(", ")})${detail}`,
  )
}
