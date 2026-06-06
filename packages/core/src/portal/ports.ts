import { connect } from "node:net"
import path from "node:path"
import { gatehouseLog } from "../log.ts"
import { DEFAULT_PORTAL_ADMIN_PORT, DEFAULT_PORTAL_DISPLAY_PORT } from "./defaults.ts"
import { portalAdminRuntimeUrl, portalRuntimeUrl, readPortalRuntimeSync } from "./runtime-info.ts"
import { preferredPortalAdminPort } from "./security.ts"

export { DEFAULT_PORTAL_ADMIN_PORT, DEFAULT_PORTAL_DISPLAY_PORT } from "./defaults.ts"

const LOCALHOST_HEALTH_TIMEOUT_MS = 300
const PORT_LISTEN_PROBE_MS = 300

export type PortalHealth = {
  ok?: boolean
  project_directory?: string
  default_project_directory?: string
  port?: number
  admin_port?: number
  admin_url?: string
}

export type PortalEndpoints = {
  displayPort: number
  displayApi: string
  adminPort?: number
  adminApi?: string
  displayReachable: boolean
  adminReachable: boolean
  source: "env"
}

export type PortalPortRole = "display" | "admin"

export class PortalPortInUseError extends Error {
  readonly port: number
  readonly role: PortalPortRole

  constructor(port: number, role: PortalPortRole, message: string) {
    super(message)
    this.name = "PortalPortInUseError"
    this.port = port
    this.role = role
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function preferredPortalDisplayPort() {
  return Number(process.env.GATEHOUSE_PORTAL_PORT ?? DEFAULT_PORTAL_DISPLAY_PORT)
}

export function portalHealthMatchesProject(projectDirectory: string, body: PortalHealth) {
  const target = path.resolve(projectDirectory)
  const fromProject =
    typeof body.project_directory === "string" ? path.resolve(body.project_directory) : undefined
  const fromDefault =
    typeof body.default_project_directory === "string"
      ? path.resolve(body.default_project_directory)
      : undefined
  return fromProject === target || fromDefault === target
}

export function isPortListening(port: number, host = "127.0.0.1") {
  return new Promise<boolean>((resolve) => {
    const socket = connect({ host, port })
    const done = (listening: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(listening)
    }
    const timer = setTimeout(() => done(false), PORT_LISTEN_PROBE_MS)
    socket.once("connect", () => {
      clearTimeout(timer)
      done(true)
    })
    socket.once("error", () => {
      clearTimeout(timer)
      done(false)
    })
  })
}

export async function fetchPortalHealth(port: number) {
  const response = await fetch(`http://127.0.0.1:${port}/portal/api/health`, {
    signal: AbortSignal.timeout(LOCALHOST_HEALTH_TIMEOUT_MS),
  }).catch(() => undefined)
  if (!response?.ok) return undefined
  const body = (await response.json().catch(() => undefined)) as unknown
  if (!isRecord(body)) return undefined
  return body as PortalHealth
}

export async function fetchAdminReachable(port: number) {
  const response = await fetch(`http://127.0.0.1:${port}/portal/api/admin/status`, {
    signal: AbortSignal.timeout(LOCALHOST_HEALTH_TIMEOUT_MS),
  }).catch(() => undefined)
  if (!response?.ok) return false
  const contentType = response.headers.get("Content-Type") ?? ""
  return contentType.includes("application/json")
}

function endpointsFromDisplay(
  displayPort: number,
  adminPort: number | undefined,
  reachable: { display: boolean; admin: boolean },
): PortalEndpoints {
  return {
    displayPort,
    displayApi: portalRuntimeUrl(displayPort).replace(/\/$/, ""),
    ...(adminPort
      ? {
          adminPort,
          adminApi: portalAdminRuntimeUrl(adminPort).replace(/\/admin$/, ""),
        }
      : {}),
    displayReachable: reachable.display,
    adminReachable: reachable.admin,
    source: "env",
  }
}

export function formatPortalPortChangeHint() {
  const altDisplay = DEFAULT_PORTAL_DISPLAY_PORT + 26
  const altAdmin = DEFAULT_PORTAL_ADMIN_PORT + 26
  return [
    "Assign different ports for this project, for example:",
    `  GATEHOUSE_PORTAL_PORT=${altDisplay} GATEHOUSE_PORTAL_ADMIN_PORT=${altAdmin} bun run dev /path/to/project`,
    "Or export GATEHOUSE_PORTAL_PORT / GATEHOUSE_PORTAL_ADMIN_PORT in your shell.",
  ].join("\n")
}

async function describePortOccupant(port: number) {
  const health = await Promise.race([
    fetchPortalHealth(port),
    Bun.sleep(100).then(() => undefined),
  ])
  if (!health) return undefined
  const project = health.project_directory ?? health.default_project_directory
  if (project) return `Gatehouse Portal (project ${project})`
  return "Gatehouse Portal"
}

export async function assertPortalPortAvailable(port: number, role: PortalPortRole) {
  if (!(await isPortListening(port))) return
  const occupant = await describePortOccupant(port)
  const label = role === "display" ? "Portal" : "Admin"
  const detail = occupant ? `: ${occupant}` : ""
  throw new PortalPortInUseError(
    port,
    role,
    `[gatehouse/portal] Port ${port} (${label}) is already in use${detail}.\n${formatPortalPortChangeHint()}`,
  )
}

export function notifyPortalPortInUse(projectDirectory: string, error: PortalPortInUseError) {
  const directory = projectDirectory.trim()
  if (!directory) return
  gatehouseLog("error", error.message, {
    projectDirectory: directory,
    title: "Portal",
    tui: true,
  })
}

export function configuredPortalEndpoints(options?: {
  displayPreferred?: number
  adminPreferred?: number
}): PortalEndpoints {
  const displayPort = options?.displayPreferred ?? preferredPortalDisplayPort()
  const adminPort = options?.adminPreferred ?? preferredPortalAdminPort()
  return endpointsFromDisplay(displayPort, adminPort, { display: false, admin: false })
}

export async function probePortalEndpoints(
  projectDirectory: string,
  options?: {
    displayApiEnv?: string
    adminApiEnv?: string
    displayPreferred?: number
    adminPreferred?: number
  },
): Promise<PortalEndpoints> {
  const displayPreferred = options?.displayPreferred ?? preferredPortalDisplayPort()
  const adminPreferred = options?.adminPreferred ?? preferredPortalAdminPort()

  let displayPort = displayPreferred
  if (options?.displayApiEnv) {
    try {
      displayPort = Number(new URL(options.displayApiEnv).port || displayPreferred)
    } catch {
      displayPort = displayPreferred
    }
  }

  let adminPort = adminPreferred
  if (options?.adminApiEnv) {
    try {
      adminPort = Number(new URL(options.adminApiEnv).port || adminPreferred)
    } catch {
      adminPort = adminPreferred
    }
  }

  const health = await fetchPortalHealth(displayPort)
  const displayReachable = Boolean(health?.ok && portalHealthMatchesProject(projectDirectory, health))
  const adminReachable = await fetchAdminReachable(adminPort)

  return endpointsFromDisplay(displayPort, adminPort, {
    display: displayReachable,
    admin: adminReachable,
  })
}

/** @deprecated Use probePortalEndpoints — kept for existing imports. */
export const discoverPortalEndpoints = probePortalEndpoints

export function applyDisplayPortalEnv(port: number) {
  process.env.GATEHOUSE_PORTAL_PORT = String(port)
  process.env.GATEHOUSE_PORTAL_URL = portalRuntimeUrl(port)
  process.env.GATEHOUSE_PORTAL_API = portalRuntimeUrl(port).replace(/\/$/, "")
}

export function applyAdminPortalEnv(port: number) {
  process.env.GATEHOUSE_PORTAL_ADMIN_PORT = String(port)
  process.env.GATEHOUSE_PORTAL_ADMIN_API = portalAdminRuntimeUrl(port).replace(/\/admin$/, "")
}

export function readDisplayPortalApiFromRuntime(projectDirectory: string) {
  const runtime = readPortalRuntimeSync(projectDirectory)
  if (!runtime?.port) return undefined
  return portalRuntimeUrl(runtime.port).replace(/\/$/, "")
}
