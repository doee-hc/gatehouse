import path from "node:path"
import { gatehousePackageRoot, gatehousePortalUiReady } from "../setup/package.ts"
import { portalRuntimeUrl, writePortalRuntime } from "./runtime-info.ts"
import { ensurePortalAdminServer, getActivePortalAdminPort, stopPortalAdminServer } from "./admin-server.ts"
import { gatehouseLog } from "../log.ts"
import { portalInternalToken } from "./security.ts"
import {
  applyAdminPortalEnv,
  applyDisplayPortalEnv,
  assertPortalPortAvailable,
  formatPortalPortChangeHint,
  PortalPortInUseError,
  preferredPortalDisplayPort,
} from "./ports.ts"
import { preferredPortalAdminPort } from "./security.ts"
import { createPortalFetchHandler } from "./portal-fetch.ts"
import {
  createPortalViteDevServer,
  portalViteDevEnabled,
  portalViteDevReady,
  type PortalViteDevServer,
} from "./vite-dev.ts"
import { setPortalInProcessDelivery } from "./events.ts"
import { initPortalDisplaySettings } from "./portal-display-settings.ts"
import { ensureOpencodeBridge, stopOpencodeBridge } from "./opencode-bridge.ts"
import { getCachedPortalSnapshot } from "./snapshot.ts"

type PortalServerHandle = {
  stop: () => void
  port?: number
}

let sharedServer: PortalServerHandle | undefined
let sharedViteDev: PortalViteDevServer | undefined
let activePortalPort: number | undefined
let portalStartupLogged = false
let portalPackageRoot = gatehousePackageRoot(import.meta.dir)
let defaultProjectDirectory = path.resolve(process.env.GATEHOUSE_PROJECT_DIR ?? process.cwd())

type PortalStartupInfo = {
  projectDirectory: string
  port: number
  adminPort?: number
  viteDev?: boolean
}

function logPortalStartup(info: PortalStartupInfo) {
  if (portalStartupLogged) return
  portalStartupLogged = true
  const ctx = { projectDirectory: info.projectDirectory, title: "Portal" }
  gatehouseLog("info", `[gatehouse/portal] API http://127.0.0.1:${info.port}/portal/api/snapshot`, ctx)
  if (info.adminPort) {
    gatehouseLog("info", `[gatehouse/portal] Admin http://127.0.0.1:${info.adminPort}/admin`, ctx)
  }
  if (gatehousePortalUiReady(portalPackageRoot)) {
    const uiUrl = portalRuntimeUrl(info.port)
    gatehouseLog(
      "info",
      `[gatehouse/portal] UI ${uiUrl}${info.viteDev ? " (Vite dev)" : ""}`,
      ctx,
    )
  }
  gatehouseLog("info", `[gatehouse/portal] project ${info.projectDirectory}`, ctx)
}

async function publishPortalRuntime(projectDirectory: string, port: number, adminPort?: number) {
  activePortalPort = port
  applyDisplayPortalEnv(port)
  if (adminPort) applyAdminPortalEnv(adminPort)
  await writePortalRuntime(projectDirectory, port, adminPort, portalInternalToken())
}

function opencodeUrl() {
  return process.env.OPENCODE_URL ?? process.env.OPENCODE_SERVER_URL ?? "http://127.0.0.1:4096"
}

function warmPortalBackgroundTasks(projectDirectory: string) {
  const url = opencodeUrl()
  void ensureOpencodeBridge(projectDirectory, url)
  // buildPortalSnapshot schedules office layout sync when assets are stale.
  void getCachedPortalSnapshot(projectDirectory, url).catch(() => undefined)
}

function getListenPort() {
  return activePortalPort ?? sharedServer?.port
}

async function createPortalServer(packageRoot: string, port: number) {
  const handlePortalFetch = createPortalFetchHandler({
    packageRoot,
    defaultProjectDirectory,
    getListenPort,
    serveStaticUi: true,
  })

  if (portalViteDevEnabled() && portalViteDevReady(packageRoot)) {
    sharedViteDev = await createPortalViteDevServer({
      packageRoot,
      port,
      defaultProjectDirectory,
      getListenPort,
    })
    activePortalPort = sharedViteDev.port
    return {
      port: sharedViteDev.port,
      stop: () => {
        void sharedViteDev?.close().finally(() => {
          sharedViteDev = undefined
        })
      },
    } satisfies PortalServerHandle
  }

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch: async (request, server) => {
      if (new URL(request.url).pathname === "/portal/events") server.timeout(request, 0)
      return handlePortalFetch(request)
    },
  })
  activePortalPort = server.port ?? port
  return server
}

function portalPortInUseError(port: number, role: "display" | "admin") {
  return new PortalPortInUseError(
    port,
    role,
    `[gatehouse/portal] Port ${port} (${role === "display" ? "Portal" : "Admin"}) is already in use.\n${formatPortalPortChangeHint()}`,
  )
}

export async function ensurePortalServer(projectDirectory: string, packageRoot?: string) {
  defaultProjectDirectory = path.resolve(projectDirectory)
  if (packageRoot) portalPackageRoot = path.resolve(packageRoot)
  initPortalDisplaySettings(defaultProjectDirectory)

  if (sharedServer) {
    const port = activePortalPort ?? sharedServer.port ?? preferredPortalDisplayPort()
    await ensurePortalAdminServer(defaultProjectDirectory, portalPackageRoot)
    const adminPort = getActivePortalAdminPort()
    await publishPortalRuntime(defaultProjectDirectory, port, adminPort)
    setPortalInProcessDelivery(true)
    logPortalStartup({
      projectDirectory: defaultProjectDirectory,
      port,
      adminPort,
      viteDev: portalViteDevEnabled(),
    })
    warmPortalBackgroundTasks(defaultProjectDirectory)
    return sharedServer
  }

  const port = preferredPortalDisplayPort()
  const adminPortPreferred = preferredPortalAdminPort()
  await assertPortalPortAvailable(port, "display")
  await assertPortalPortAvailable(adminPortPreferred, "admin")

  try {
    sharedServer = await createPortalServer(portalPackageRoot, port)
    await ensurePortalAdminServer(defaultProjectDirectory, portalPackageRoot)
    setPortalInProcessDelivery(true)
  } catch (error) {
    if (isAddrInUse(error)) throw portalPortInUseError(port, "display")
    throw error
  }

  const listenPort = activePortalPort ?? port
  const adminPort = getActivePortalAdminPort()
  await publishPortalRuntime(defaultProjectDirectory, listenPort, adminPort)
  logPortalStartup({
    projectDirectory: defaultProjectDirectory,
    port: listenPort,
    adminPort,
    viteDev: portalViteDevEnabled(),
  })
  warmPortalBackgroundTasks(defaultProjectDirectory)
  return sharedServer
}

export function startPortalServer(projectDirectory: string) {
  void ensurePortalServer(projectDirectory)
}

export function stopPortalServer(_projectDirectory?: string) {
  setPortalInProcessDelivery(false)
  stopOpencodeBridge()
  stopPortalAdminServer()
  if (sharedViteDev) {
    void sharedViteDev.close()
    sharedViteDev = undefined
  }
  if (!sharedServer) return
  sharedServer.stop()
  sharedServer = undefined
  activePortalPort = undefined
}

function isAddrInUse(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EADDRINUSE"
}
