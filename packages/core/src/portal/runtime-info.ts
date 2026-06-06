import { existsSync, readFileSync } from "node:fs"
import { portalRuntimePath } from "../paths.ts"

export type PortalRuntimeInfo = {
  port: number
  url: string
  admin_port?: number
  admin_url?: string
  internal_token?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function portalRuntimeUrl(port: number) {
  return `http://127.0.0.1:${port}/`
}

export function portalAdminRuntimeUrl(port: number) {
  return `http://127.0.0.1:${port}/admin`
}

export async function writePortalRuntime(
  projectDirectory: string,
  port: number,
  adminPort?: number,
  internalToken?: string,
) {
  const url = portalRuntimeUrl(port)
  const payload: Record<string, unknown> = {
    port,
    url,
    updated_at: new Date().toISOString(),
  }
  if (adminPort) {
    payload.admin_port = adminPort
    payload.admin_url = portalAdminRuntimeUrl(adminPort)
  }
  if (internalToken) payload.internal_token = internalToken
  await Bun.write(portalRuntimePath(projectDirectory), `${JSON.stringify(payload, null, 2)}\n`)
}

export function readPortalRuntimeSync(projectDirectory: string): PortalRuntimeInfo | undefined {
  const file = portalRuntimePath(projectDirectory)
  if (!existsSync(file)) return undefined
  const raw = readFileSync(file, "utf8")
  const data = JSON.parse(raw) as unknown
  if (!isRecord(data)) return undefined
  const port = typeof data.port === "number" ? data.port : Number(data.port)
  if (!Number.isFinite(port) || port <= 0) return undefined
  const url = typeof data.url === "string" && data.url.trim() ? data.url.trim() : portalRuntimeUrl(port)
  const adminPort =
    typeof data.admin_port === "number"
      ? data.admin_port
      : typeof data.admin_port === "string"
        ? Number(data.admin_port)
        : undefined
  const adminUrl =
    typeof data.admin_url === "string" && data.admin_url.trim()
      ? data.admin_url.trim()
      : adminPort && Number.isFinite(adminPort)
        ? portalAdminRuntimeUrl(adminPort)
        : undefined
  const internalToken =
    typeof data.internal_token === "string" && data.internal_token.trim()
      ? data.internal_token.trim()
      : undefined
  return {
    port,
    url,
    ...(adminPort && Number.isFinite(adminPort) ? { admin_port: adminPort } : {}),
    ...(adminUrl ? { admin_url: adminUrl } : {}),
    ...(internalToken ? { internal_token: internalToken } : {}),
  }
}
