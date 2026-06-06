import {
  buildChannelAdminSnapshot,
  CHANNEL_IDS,
  getWeixinLoginSessionManager,
  initChannelsConfig,
  startChannelSupervisorFromAdmin,
  stopChannelSupervisorFromAdmin,
  type ChannelId,
} from "@gatehouse/channels-core"
import { gatehousePackageRoot } from "../setup/package.ts"
import { adminAuthStatus, createAdminSession, validateAdminToken } from "./admin-auth.ts"

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  })
}

function unauthorized() {
  return json({ error: "unauthorized" }, 401)
}

function badRequest(message: string) {
  return json({ error: message }, 400)
}

function parseChannelId(value: string): ChannelId | undefined {
  return CHANNEL_IDS.includes(value as ChannelId) ? (value as ChannelId) : undefined
}

export async function handlePortalAdminRequest(
  url: URL,
  request: Request,
  projectDirectory: string,
): Promise<Response | undefined> {
  const pathname = url.pathname

  if (pathname === "/portal/api/admin/status" && request.method === "GET") {
    return json(adminAuthStatus(projectDirectory))
  }

  if (pathname === "/portal/api/admin/session" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { key?: string }
    const key = body.key?.trim() ?? ""
    if (!key) return badRequest("key required")
    const result = createAdminSession(projectDirectory, key)
    if (!result.ok) {
      const status = result.reason === "admin_key_not_configured" ? 503 : 401
      return json({ error: result.reason }, status)
    }
    return json({ token: result.token, expiresAt: result.expiresAt })
  }

  if (!pathname.startsWith("/portal/api/channels")) return undefined
  if (!validateAdminToken(projectDirectory, request)) return unauthorized()

  if (pathname === "/portal/api/channels" && request.method === "GET") {
    initChannelsConfig(projectDirectory)
    return json(buildChannelAdminSnapshot(projectDirectory))
  }

  if (pathname === "/portal/api/channels/supervisor/start" && request.method === "POST") {
    initChannelsConfig(projectDirectory)
    const body = (await request.json().catch(() => ({}))) as { channels?: string[] }
    const channels = body.channels
      ?.map((value) => parseChannelId(value.trim()))
      .filter((value): value is ChannelId => Boolean(value))
    const result = await startChannelSupervisorFromAdmin(
      projectDirectory,
      channels?.length ? channels : undefined,
      gatehousePackageRoot(import.meta.dir),
    )
    if (!result.ok) return badRequest(result.reason)
    return json({
      ok: true,
      pid: result.pid,
      alreadyRunning: result.alreadyRunning ?? false,
      snapshot: buildChannelAdminSnapshot(projectDirectory),
    })
  }

  if (pathname === "/portal/api/channels/supervisor/stop" && request.method === "POST") {
    const result = await stopChannelSupervisorFromAdmin(projectDirectory)
    return json({
      ok: true,
      stopped: result.stopped,
      reason: result.reason,
      pid: result.pid,
      snapshot: buildChannelAdminSnapshot(projectDirectory),
    })
  }

  if (pathname === "/portal/api/channels/weixin/login" && request.method === "POST") {
    initChannelsConfig(projectDirectory)
    const manager = getWeixinLoginSessionManager(projectDirectory)
    const session = await manager.startSession()
    return json({ session })
  }

  const loginMatch = pathname.match(/^\/portal\/api\/channels\/weixin\/login\/([^/]+)$/)
  if (loginMatch) {
    const sessionId = decodeURIComponent(loginMatch[1]!)
    const manager = getWeixinLoginSessionManager(projectDirectory)
    if (request.method === "GET") {
      const session = (await manager.tickSession(sessionId)) ?? manager.getSession(sessionId)
      if (!session) return json({ error: "session_not_found" }, 404)
      return json({ session })
    }
    if (request.method === "DELETE") {
      const cancelled = manager.cancelSession(sessionId)
      return json({ ok: cancelled })
    }
  }

  return json({ error: "not_found" }, 404)
}
