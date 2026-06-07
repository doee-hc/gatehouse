import { portalProjectDirectory, resolvePortalProjectDirectory } from "../api/project-directory.ts"
import { t } from "../shell/i18n.ts"

const TOKEN_KEY = "gatehouse.admin.token"

let cachedAdminDirectory: string | undefined

export async function ensureAdminProjectDirectory() {
  if (cachedAdminDirectory) return cachedAdminDirectory
  cachedAdminDirectory = portalProjectDirectory() ?? (await resolvePortalProjectDirectory())
  return cachedAdminDirectory
}

function withDirectory(pathname: string, directory?: string) {
  if (!directory) return pathname
  const separator = pathname.includes("?") ? "&" : "?"
  return `${pathname}${separator}directory=${encodeURIComponent(directory)}`
}

async function adminUrl(pathname: string) {
  return withDirectory(pathname, await ensureAdminProjectDirectory())
}

export type AdminAuthStatus = {
  configured: boolean
}

export type ChannelRuntime = {
  pid?: number
  status?: string
  restarts?: number
  lastError?: string
}

export type ChannelEntry = {
  id: string
  enabled: boolean
  configured: boolean
  runtime?: ChannelRuntime
}

export type ChannelAdminSnapshot = {
  channels: ChannelEntry[]
  supervisor: {
    running: boolean
    pid?: number
    startedAt?: number
  }
}

export type WeixinLoginSession = {
  id: string
  phase: string
  qrContent?: string
  qrToken?: string
  message?: string
}

function requireAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = sessionStorage.getItem(TOKEN_KEY)
  if (!token) throw new Error(t("admin.error.notLoggedIn"))
  return { Authorization: `Bearer ${token}`, ...extra }
}

async function parseJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("Content-Type") ?? ""
  if (!contentType.includes("application/json")) {
    throw new Error(t("admin.error.nonJson", { status: response.status }))
  }
  const data = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : `HTTP ${response.status}`
    throw new Error(message)
  }
  return data
}

export function getAdminToken() {
  return sessionStorage.getItem(TOKEN_KEY)
}

export function setAdminToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token)
}

export function clearAdminToken() {
  sessionStorage.removeItem(TOKEN_KEY)
}

export async function fetchAdminStatus() {
  const response = await fetch(await adminUrl("/portal/api/admin/status"))
  return parseJson<AdminAuthStatus>(response)
}

export async function createAdminSession(key: string) {
  const response = await fetch(await adminUrl("/portal/api/admin/session"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  })
  return parseJson<{ token: string; expiresAt: number }>(response)
}

export async function fetchChannelsSnapshot() {
  const response = await fetch(await adminUrl("/portal/api/channels"), { headers: requireAuthHeaders() })
  return parseJson<ChannelAdminSnapshot>(response)
}

export async function startSupervisor(channels?: string[]) {
  const response = await fetch(await adminUrl("/portal/api/channels/supervisor/start"), {
    method: "POST",
    headers: requireAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(channels?.length ? { channels } : {}),
  })
  return parseJson<{ ok: boolean; snapshot: ChannelAdminSnapshot; alreadyRunning?: boolean }>(response)
}

export async function stopSupervisor() {
  const response = await fetch(await adminUrl("/portal/api/channels/supervisor/stop"), {
    method: "POST",
    headers: requireAuthHeaders(),
  })
  return parseJson<{ ok: boolean; snapshot: ChannelAdminSnapshot; stopped?: boolean; reason?: string }>(response)
}

export async function startWeixinLogin() {
  const response = await fetch(await adminUrl("/portal/api/channels/weixin/login"), {
    method: "POST",
    headers: requireAuthHeaders(),
  })
  return parseJson<{ session: WeixinLoginSession }>(response)
}

export async function pollWeixinLogin(sessionId: string) {
  const response = await fetch(
    await adminUrl(`/portal/api/channels/weixin/login/${encodeURIComponent(sessionId)}`),
    { headers: requireAuthHeaders() },
  )
  return parseJson<{ session: WeixinLoginSession }>(response)
}

export async function cancelWeixinLogin(sessionId: string) {
  const response = await fetch(
    await adminUrl(`/portal/api/channels/weixin/login/${encodeURIComponent(sessionId)}`),
    { method: "DELETE", headers: requireAuthHeaders() },
  )
  return parseJson<{ ok: boolean }>(response)
}
