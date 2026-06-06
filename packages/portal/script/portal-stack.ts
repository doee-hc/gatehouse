#!/usr/bin/env bun
/**
 * Portal dev stack: API + Vite middleware + Admin on fixed ports, independent of OpenCode.
 */
import path from "node:path"
import { DEFAULT_PORTAL_ADMIN_PORT, DEFAULT_PORTAL_DISPLAY_PORT } from "../../core/src/portal/defaults.ts"
import {
  assertPortalPortAvailable,
  configuredPortalEndpoints,
  fetchPortalHealth,
  notifyPortalPortInUse,
  PortalPortInUseError,
  type PortalEndpoints,
} from "../../core/src/portal/ports.ts"
import { readPortalRuntimeSync } from "../../core/src/portal/runtime-info.ts"

const portalRoot = path.resolve(import.meta.dir, "..")
const gatehouseCoreRoot = path.resolve(portalRoot, "../core")
const displayPreferredPort = process.env.GATEHOUSE_PORTAL_PORT ?? String(DEFAULT_PORTAL_DISPLAY_PORT)
const adminPreferredPort = process.env.GATEHOUSE_PORTAL_ADMIN_PORT ?? String(DEFAULT_PORTAL_ADMIN_PORT)
const opencodePort = process.env.OPENCODE_PORT ?? "4096"
const projectDir = path.resolve(process.env.GATEHOUSE_PROJECT_DIR ?? process.cwd())

let portalApi = process.env.GATEHOUSE_PORTAL_API ?? `http://127.0.0.1:${displayPreferredPort}`
let portalAdminApi = process.env.GATEHOUSE_PORTAL_ADMIN_API ?? `http://127.0.0.1:${adminPreferredPort}`
let endpoints: PortalEndpoints | undefined

let apiProc: ReturnType<typeof Bun.spawn> | undefined
let ownedApi = false

function localDevEnv(extra: Record<string, string | undefined>) {
  return {
    ...process.env,
    ...extra,
    NO_PROXY: "127.0.0.1,localhost,127.*,[::1]",
    no_proxy: "127.0.0.1,localhost,127.*,[::1]",
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    http_proxy: "",
    https_proxy: "",
  }
}

function portalFastStopEnabled(options?: { fast?: boolean }) {
  return options?.fast === true || process.env.GATEHOUSE_PORTAL_FAST_STOP === "1"
}

function collectConfiguredPortalPorts() {
  const ports = new Set<number>()
  ports.add(Number(displayPreferredPort))
  ports.add(Number(adminPreferredPort))

  const runtime = readPortalRuntimeSync(projectDir)
  if (runtime?.port) ports.add(runtime.port)
  if (runtime?.admin_port) ports.add(runtime.admin_port)

  if (endpoints?.displayPort) ports.add(endpoints.displayPort)
  if (endpoints?.adminPort) ports.add(endpoints.adminPort)

  const legacyUiPort = Number(process.env.GATEHOUSE_PORTAL_UI_PORT ?? 0)
  if (legacyUiPort > 0) ports.add(legacyUiPort)

  return [...ports].filter((port) => Number.isFinite(port) && port > 0)
}

async function killPorts(ports: Iterable<number>, options?: { fast?: boolean }) {
  const unique = [...new Set(ports)].filter((port) => Number.isFinite(port) && port > 0)
  if (unique.length === 0) return

  await Promise.all(
    unique.map(async (port) => {
      const proc = Bun.spawn(["fuser", "-k", `${port}/tcp`], {
        stdout: "ignore",
        stderr: "ignore",
      })
      await proc.exited.catch(() => undefined)
    }),
  )

  await Bun.sleep(portalFastStopEnabled(options) ? 80 : 150)
}

function syncConfiguredEndpoints() {
  endpoints = configuredPortalEndpoints({
    displayPreferred: Number(displayPreferredPort),
    adminPreferred: Number(adminPreferredPort),
  })
  portalApi = endpoints.displayApi
  if (endpoints.adminApi) portalAdminApi = endpoints.adminApi
  return endpoints
}

async function killConfiguredPortalPorts(options?: { fast?: boolean }) {
  await killPorts(collectConfiguredPortalPorts(), options)
}

async function waitForPortalReady() {
  const displayPort = Number(displayPreferredPort)
  for (let attempt = 0; attempt < 50; attempt++) {
    const health = await fetchPortalHealth(displayPort)
    if (health?.ok) return true
    if (apiProc && apiProc.exitCode !== null) return false
    await Bun.sleep(100)
  }
  return false
}

function stopOwnedApi() {
  if (!ownedApi || !apiProc || apiProc.exitCode !== null) return
  apiProc.kill()
  apiProc = undefined
  ownedApi = false
}

async function stopOwnedProcesses() {
  stopOwnedApi()
}

function bindShutdown() {
  const shutdown = async () => {
    const killApi = ownedApi
    await stopOwnedProcesses()
    if (killApi) await killConfiguredPortalPorts({ fast: true })
    process.exit(130)
  }
  process.on("SIGINT", () => void shutdown())
  process.on("SIGTERM", () => void shutdown())
}

async function ensureAssets() {
  await Bun.spawn(["bun", "script/ensure-assets.ts"], {
    cwd: portalRoot,
    stdout: "inherit",
    stderr: "inherit",
  }).exited
}

function logPortalEndpoints(resolved: PortalEndpoints) {
  console.log(`[gatehouse/portal] Portal → ${resolved.displayApi}/`)
  console.log(`[gatehouse/portal] API → ${resolved.displayApi}/portal/api/snapshot`)
  if (resolved.adminApi) {
    console.log(`[gatehouse/portal] Admin → ${resolved.adminApi}/admin`)
  }
}

function portalServerEnv(viteDev: boolean) {
  return localDevEnv({
    GATEHOUSE_PROJECT_DIR: projectDir,
    OPENCODE_URL: `http://127.0.0.1:${opencodePort}`,
    GATEHOUSE_PORTAL_PORT: displayPreferredPort,
    GATEHOUSE_PORTAL_ADMIN_PORT: adminPreferredPort,
    ...(viteDev ? { GATEHOUSE_PORTAL_VITE_DEV: "1" } : {}),
    ...(process.env.GATEHOUSE_SNAPSHOT_POLL_MS
      ? { GATEHOUSE_SNAPSHOT_POLL_MS: process.env.GATEHOUSE_SNAPSHOT_POLL_MS }
      : {}),
  })
}

function exitOnPortConflict(error: unknown) {
  if (error instanceof PortalPortInUseError) {
    notifyPortalPortInUse(projectDir, error)
    console.error(error.message)
    process.exit(1)
  }
  throw error
}

async function assertConfiguredPortsFree() {
  const displayPort = Number(displayPreferredPort)
  const adminPort = Number(adminPreferredPort)
  await assertPortalPortAvailable(displayPort, "display")
  await assertPortalPortAvailable(adminPort, "admin")
}

async function startApiBackground(viteDev: boolean) {
  ownedApi = true
  apiProc = Bun.spawn(["bun", "script/portal-server.ts"], {
    cwd: gatehouseCoreRoot,
    env: portalServerEnv(viteDev),
    stdout: "inherit",
    stderr: "inherit",
  })
  const ready = await waitForPortalReady()
  if (!ready) {
    console.error(`[gatehouse/portal] API failed to start on port ${displayPreferredPort}`)
    stopOwnedApi()
    process.exit(1)
  }
  logPortalEndpoints(syncConfiguredEndpoints())
}

async function startApiForeground(viteDev: boolean) {
  console.log(`[gatehouse/portal] Portal → project ${projectDir}`)
  const proc = Bun.spawn(["bun", "script/portal-server.ts"], {
    cwd: gatehouseCoreRoot,
    env: portalServerEnv(viteDev),
    stdout: "inherit",
    stderr: "inherit",
  })
  process.exit(await proc.exited)
}

async function ensureApi(viteDev: boolean) {
  try {
    await assertConfiguredPortsFree()
  } catch (error) {
    exitOnPortConflict(error)
  }
  await startApiBackground(viteDev)
}

async function preparePortalAssets() {
  await ensureAssets()
}

async function startStack() {
  bindShutdown()
  await preparePortalAssets()
  try {
    await ensureApi(true)
  } catch (error) {
    exitOnPortConflict(error)
  }
  console.log(`[gatehouse/portal] dev UI with Vite middleware — open ${portalApi}/`)
  await Bun.sleep(Number.POSITIVE_INFINITY)
}

async function restartStack() {
  bindShutdown()
  stopOwnedApi()
  await killConfiguredPortalPorts()
  await preparePortalAssets()
  try {
    await assertConfiguredPortsFree()
    await startApiBackground(true)
  } catch (error) {
    exitOnPortConflict(error)
  }
  console.log(`[gatehouse/portal] dev UI with Vite middleware — open ${portalApi}/`)
  await Bun.sleep(Number.POSITIVE_INFINITY)
}

async function stopApi() {
  stopOwnedApi()
  await killConfiguredPortalPorts()
  console.log(`[gatehouse/portal] stopped Portal API/Admin for ${projectDir}`)
}

async function stopStack() {
  await stopOwnedProcesses()
  await killConfiguredPortalPorts({ fast: true })
}

async function restartApiOnly() {
  try {
    await assertConfiguredPortsFree()
  } catch (error) {
    exitOnPortConflict(error)
  }
  await startApiForeground(false)
}

async function startApiDaemon() {
  bindShutdown()
  try {
    await ensureApi(false)
  } catch (error) {
    exitOnPortConflict(error)
  }
  console.log(`[gatehouse/portal] API daemon running (static UI from dist/portal when built)`)
  await Bun.sleep(Number.POSITIVE_INFINITY)
}

const command = process.argv[2] ?? "start"

if (command === "stop-api") {
  await stopApi()
  process.exit(0)
}

if (command === "stop-ui" || command === "stop") {
  await stopStack()
  process.exit(0)
}

if (command === "restart") {
  await restartStack()
  process.exit(0)
}

if (command === "start") {
  await startStack()
  process.exit(0)
}

if (command === "ui" || command === "restart-ui") {
  console.warn(`[gatehouse/portal] "${command}" is deprecated — UI is served on the display port via Vite middleware`)
  bindShutdown()
  stopOwnedApi()
  await killConfiguredPortalPorts()
  await preparePortalAssets()
  try {
    await assertConfiguredPortsFree()
    await startApiBackground(true)
  } catch (error) {
    exitOnPortConflict(error)
  }
  await Bun.sleep(Number.POSITIVE_INFINITY)
  process.exit(0)
}

if (command === "restart-api") {
  await restartApiOnly()
  process.exit(0)
}

if (command === "api") {
  await startApiDaemon()
  process.exit(0)
}

console.error(
  `usage: bun script/portal-stack.ts [start|restart|stop|api|restart-api|stop-api]`,
)
process.exit(1)
