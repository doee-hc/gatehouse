import { existsSync } from "node:fs"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import path from "node:path"
import { gatehouseLog } from "../log.ts"
import { gatehousePortalSourceDir } from "../setup/package.ts"
import { createPortalFetchHandler, isPortalApiPath } from "./portal-fetch.ts"

type ViteDevServer = {
  middlewares: (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void
  close: () => Promise<void>
}

export type PortalViteDevServer = {
  port: number
  httpServer: Server
  vite: ViteDevServer
  close: () => Promise<void>
}

export function portalViteDevEnabled() {
  return process.env.GATEHOUSE_PORTAL_VITE_DEV === "1"
}

export function portalViteDevReady(packageRoot: string) {
  const portalRoot = gatehousePortalSourceDir(packageRoot)
  return (
    existsSync(path.join(portalRoot, "index.html")) &&
    existsSync(path.join(portalRoot, "vite.config.ts")) &&
    existsSync(path.join(portalRoot, "node_modules/vite/package.json"))
  )
}

async function readNodeRequestBody(req: IncomingMessage) {
  if (req.method === "GET" || req.method === "HEAD") return undefined
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  if (chunks.length === 0) return undefined
  return Buffer.concat(chunks)
}

async function nodeRequestToWeb(req: IncomingMessage, baseUrl: string) {
  const url = new URL(req.url ?? "/", baseUrl)
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue
    headers.set(key, Array.isArray(value) ? value.join(", ") : value)
  }
  const body = await readNodeRequestBody(req)
  return new Request(url, {
    method: req.method,
    headers,
    body,
  })
}

async function sendWebResponse(res: ServerResponse, response: Response, method?: string) {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "connection") return
    res.setHeader(key, value)
  })

  if (response.status === 204 || method === "HEAD") {
    res.end()
    return
  }

  if (!response.body) {
    res.end()
    return
  }

  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(value)
    }
  } finally {
    reader.releaseLock()
  }
  res.end()
}

function rewriteAdminPath(req: IncomingMessage) {
  const url = req.url ?? ""
  if (url === "/admin" || url.startsWith("/admin?")) {
    const query = url.includes("?") ? url.slice(url.indexOf("?")) : ""
    req.url = `/admin.html${query}`
  }
}

async function importViteDevServerCreator(portalRoot: string) {
  const viteEntry = path.join(portalRoot, "node_modules/vite/dist/node/index.js")
  const mod = (await import(viteEntry)) as {
    createServer: (inlineConfig: Record<string, unknown>) => Promise<ViteDevServer & { ws?: unknown }>
  }
  return mod.createServer
}

export async function createPortalViteDevServer(input: {
  packageRoot: string
  port: number
  defaultProjectDirectory: string
  getListenPort: () => number | undefined
}) {
  const portalRoot = gatehousePortalSourceDir(input.packageRoot)
  if (!portalViteDevReady(input.packageRoot)) {
    throw new Error(
      `Portal Vite dev unavailable — expected ${portalRoot} with vite installed. Run bun install in packages/portal.`,
    )
  }

  const httpServer = createServer()
  const previousMiddlewareFlag = process.env.GATEHOUSE_PORTAL_VITE_MIDDLEWARE
  process.env.GATEHOUSE_PORTAL_VITE_MIDDLEWARE = "1"
  process.env.GATEHOUSE_PROJECT_DIR = input.defaultProjectDirectory
  process.env.VITE_GATEHOUSE_PROJECT_DIR = input.defaultProjectDirectory

  let vite: ViteDevServer | undefined
  try {
    const createViteServer = await importViteDevServerCreator(portalRoot)
    vite = await createViteServer({
      root: portalRoot,
      configFile: path.join(portalRoot, "vite.config.ts"),
      appType: "spa",
      envPrefix: ["VITE_", "GATEHOUSE_"],
      server: {
        middlewareMode: true,
        hmr: { server: httpServer },
      },
    })
  } finally {
    if (previousMiddlewareFlag === undefined) delete process.env.GATEHOUSE_PORTAL_VITE_MIDDLEWARE
    else process.env.GATEHOUSE_PORTAL_VITE_MIDDLEWARE = previousMiddlewareFlag
  }

  const handlePortalFetch = createPortalFetchHandler({
    packageRoot: input.packageRoot,
    defaultProjectDirectory: input.defaultProjectDirectory,
    getListenPort: input.getListenPort,
    serveStaticUi: false,
  })

  httpServer.on("request", (req, res) => {
    void handleNodeRequest(req, res, vite!, handlePortalFetch, input.port)
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject)
    httpServer.listen(input.port, "127.0.0.1", () => resolve())
  })

  const address = httpServer.address()
  const listenPort = typeof address === "object" && address ? address.port : input.port

  gatehouseLog("info", `[gatehouse/portal] Vite dev middleware on ${portalRoot}`, {
    projectDirectory: input.defaultProjectDirectory,
    title: "Portal",
  })

  return {
    port: listenPort,
    httpServer,
    vite,
    close: async () => {
      await vite.close()
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()))
      })
    },
  } satisfies PortalViteDevServer
}

async function handleNodeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  vite: ViteDevServer,
  handlePortalFetch: (request: Request) => Promise<Response>,
  fallbackPort: number,
) {
  try {
    const host = req.headers.host ?? `127.0.0.1:${fallbackPort}`
    const baseUrl = `http://${host}`
    const pathname = new URL(req.url ?? "/", baseUrl).pathname

    if (isPortalApiPath(pathname)) {
      if (pathname === "/portal/events") req.socket.setTimeout(0)
      const request = await nodeRequestToWeb(req, baseUrl)
      const response = await handlePortalFetch(request)
      await sendWebResponse(res, response, req.method)
      return
    }

    rewriteAdminPath(req)
    vite.middlewares(req, res, () => {
      res.statusCode = 404
      res.end("Not Found")
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    gatehouseLog("error", `[gatehouse/portal] dev request failed: ${message}`, { title: "Portal" })
    if (!res.headersSent) {
      res.statusCode = 500
      res.end("Internal Server Error")
    } else {
      res.end()
    }
  }
}
