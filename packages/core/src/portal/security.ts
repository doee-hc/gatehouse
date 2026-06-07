import path from "node:path"
import crypto from "node:crypto"
import { DEFAULT_PORTAL_ADMIN_PORT } from "./defaults.ts"
import { resolveProjectDirectoryBySlug } from "./portal-project.ts"
import { readPortalRuntimeSync } from "./runtime-info.ts"

const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  })
}

export function preferredPortalAdminPort() {
  return Number(process.env.GATEHOUSE_PORTAL_ADMIN_PORT ?? DEFAULT_PORTAL_ADMIN_PORT)
}

export function portalAdminRuntimeUrl(port: number) {
  return `http://127.0.0.1:${port}/`
}

function configuredCorsOrigins() {
  const raw = process.env.GATEHOUSE_PORTAL_CORS_ORIGINS?.trim()
  if (!raw) return undefined
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
}

function isLocalDevOrigin(origin: string) {
  try {
    return LOCAL_DEV_HOSTS.has(new URL(origin).hostname)
  } catch {
    return false
  }
}

export function resolveCorsOrigin(request: Request) {
  const origin = request.headers.get("Origin")?.trim()
  if (!origin) return undefined

  const configured = configuredCorsOrigins()
  if (configured?.length) return configured.includes(origin) ? origin : undefined

  if (isLocalDevOrigin(origin)) return origin

  try {
    if (origin === new URL(request.url).origin) return origin
  } catch {
    // ignore malformed request URL
  }

  return undefined
}

export function applySecurityHeaders(headers: Headers) {
  headers.set("X-Content-Type-Options", "nosniff")
  headers.set("X-Frame-Options", "DENY")
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
}

export function withCors(response: Response, request: Request) {
  const headers = new Headers(response.headers)
  applySecurityHeaders(headers)

  const origin = resolveCorsOrigin(request)
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin)
    headers.set("Vary", "Origin")
  }
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, x-opencode-directory, Authorization, X-Gatehouse-Admin-Token, X-Gatehouse-Portal-Internal-Token",
  )

  return new Response(response.body, { status: response.status, headers })
}

function extraProjectDirectories() {
  const raw = process.env.GATEHOUSE_PORTAL_PROJECT_DIRS?.trim()
  if (!raw) return [] as string[]
  return raw
    .split(",")
    .map((value) => path.resolve(value.trim()))
    .filter(Boolean)
}

export function resolveProjectDirectory(url: URL, request: Request, defaultProjectDirectory: string) {
  const fromProject = url.searchParams.get("project")?.trim()
  if (fromProject) {
    const resolved = resolveProjectDirectoryBySlug(
      fromProject,
      defaultProjectDirectory,
      extraProjectDirectories(),
    )
    if (!resolved) return { ok: false as const, response: json({ error: "forbidden_project" }, 403) }
    return { ok: true as const, directory: resolved }
  }

  const fromQuery = url.searchParams.get("directory")
  const fromHeader = request.headers.get("x-opencode-directory")
  const requested = fromQuery ?? fromHeader
  if (!requested) return { ok: true as const, directory: path.resolve(defaultProjectDirectory) }

  const resolved = path.resolve(requested)
  const defaultResolved = path.resolve(defaultProjectDirectory)
  if (resolved === defaultResolved) return { ok: true as const, directory: resolved }

  const allowed = extraProjectDirectories()
  if (allowed.includes(resolved)) return { ok: true as const, directory: resolved }

  return { ok: false as const, response: json({ error: "forbidden_directory" }, 403) }
}

let runtimeInternalToken: string | undefined

function readInternalTokenFromRuntime() {
  const projectDirectory = process.env.GATEHOUSE_PROJECT_DIR?.trim()
  if (!projectDirectory) return undefined
  return readPortalRuntimeSync(projectDirectory)?.internal_token
}

export function portalInternalToken() {
  const fromEnv = process.env.GATEHOUSE_PORTAL_INTERNAL_TOKEN?.trim()
  if (fromEnv) return fromEnv
  const fromRuntime = readInternalTokenFromRuntime()
  if (fromRuntime) return fromRuntime
  if (!runtimeInternalToken) runtimeInternalToken = crypto.randomBytes(32).toString("base64url")
  return runtimeInternalToken
}

export function validatePortalInternalToken(request: Request) {
  const provided = request.headers.get("X-Gatehouse-Portal-Internal-Token")?.trim()
  if (!provided) return false
  const expected = portalInternalToken()
  const left = crypto.createHash("sha256").update(provided).digest()
  const right = crypto.createHash("sha256").update(expected).digest()
  return crypto.timingSafeEqual(left, right)
}
