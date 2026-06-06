import path from "node:path"
import { gatehousePackageRoot } from "../setup/package.ts"
import { gatehouseLog } from "../log.ts"
import { handlePortalAdminRequest } from "./channels-routes.ts"
import { tryServePortalAdminUi } from "./static-ui.ts"
import {
  applyAdminPortalEnv,
  assertPortalPortAvailable,
  formatPortalPortChangeHint,
  PortalPortInUseError,
} from "./ports.ts"
import { preferredPortalAdminPort, resolveProjectDirectory, withCors } from "./security.ts"

let sharedAdminServer: ReturnType<typeof Bun.serve> | undefined
let activeAdminPort: number | undefined

function isAddrInUse(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EADDRINUSE"
}

function logAdminStartup(port: number) {
  gatehouseLog("info", `[gatehouse/portal] Admin http://127.0.0.1:${port}/admin`, { title: "Portal Admin" })
}

function createPortalAdminServer(packageRoot: string, port: number, defaultProjectDirectory: string) {
  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch: async (request) => {
      const url = new URL(request.url)
      if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }), request)

      const projectDirectoryResult = resolveProjectDirectory(url, request, defaultProjectDirectory)
      if (!projectDirectoryResult.ok) return withCors(projectDirectoryResult.response, request)
      const projectDirectory = projectDirectoryResult.directory

      const adminResponse = await handlePortalAdminRequest(url, request, projectDirectory)
      if (adminResponse) return withCors(adminResponse, request)

      const staticUi = tryServePortalAdminUi(packageRoot, url, request.method)
      if (staticUi) return withCors(staticUi, request)

      return withCors(new Response("not found", { status: 404 }), request)
    },
  })
  activeAdminPort = server.port ?? port
  applyAdminPortalEnv(activeAdminPort)
  return server
}

export function getActivePortalAdminPort() {
  return activeAdminPort
}

export async function ensurePortalAdminServer(projectDirectory: string, packageRoot?: string) {
  const defaultProjectDirectory = path.resolve(projectDirectory)
  const resolvedPackageRoot = path.resolve(packageRoot ?? gatehousePackageRoot(import.meta.dir))

  if (sharedAdminServer) {
    logAdminStartup(activeAdminPort ?? sharedAdminServer.port ?? preferredPortalAdminPort())
    return sharedAdminServer
  }

  const port = preferredPortalAdminPort()
  await assertPortalPortAvailable(port, "admin")

  try {
    sharedAdminServer = createPortalAdminServer(resolvedPackageRoot, port, defaultProjectDirectory)
    logAdminStartup(activeAdminPort ?? port)
    return sharedAdminServer
  } catch (error) {
    if (isAddrInUse(error)) {
      throw new PortalPortInUseError(
        port,
        "admin",
        `[gatehouse/portal] Port ${port} (Admin) is already in use.\n${formatPortalPortChangeHint()}`,
      )
    }
    throw error
  }
}

export function stopPortalAdminServer() {
  if (!sharedAdminServer) return
  sharedAdminServer.stop()
  sharedAdminServer = undefined
  activeAdminPort = undefined
}
