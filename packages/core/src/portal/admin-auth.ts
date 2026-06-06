import crypto from "node:crypto"
import path from "node:path"
import { isPortalAdminConfigured, resolvePortalAdminKey } from "@gatehouse/channels-core"

const SESSION_TTL_MS = 8 * 60 * 60 * 1000

type AdminSession = {
  token: string
  projectDirectory: string
  expiresAt: number
}

const sessions = new Map<string, AdminSession>()

function timingSafeEqual(a: string, b: string) {
  const left = crypto.createHash("sha256").update(a).digest()
  const right = crypto.createHash("sha256").update(b).digest()
  return crypto.timingSafeEqual(left, right)
}

function gcSessions() {
  const now = Date.now()
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token)
  }
}

export function adminAuthStatus(projectDirectory: string) {
  return {
    configured: isPortalAdminConfigured(projectDirectory),
  }
}

export function createAdminSession(projectDirectory: string, key: string) {
  const expected = resolvePortalAdminKey(projectDirectory)
  if (!expected) {
    return { ok: false as const, reason: "admin_key_not_configured" }
  }
  if (!timingSafeEqual(key, expected)) {
    return { ok: false as const, reason: "invalid_key" }
  }

  gcSessions()
  const token = crypto.randomUUID()
  const session: AdminSession = {
    token,
    projectDirectory: path.resolve(projectDirectory),
    expiresAt: Date.now() + SESSION_TTL_MS,
  }
  sessions.set(token, session)
  return { ok: true as const, token, expiresAt: session.expiresAt }
}

export function validateAdminToken(projectDirectory: string, request: Request) {
  const header = request.headers.get("Authorization")?.trim()
  const token = header?.startsWith("Bearer ")
    ? header.slice(7).trim()
    : request.headers.get("X-Gatehouse-Admin-Token")?.trim()
  if (!token) return false

  gcSessions()
  const session = sessions.get(token)
  if (!session) return false
  if (session.projectDirectory !== path.resolve(projectDirectory)) return false
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token)
    return false
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS
  return true
}
