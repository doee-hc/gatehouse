import path from "node:path"
import { existsSync } from "node:fs"
import { buildBlogSnapshot } from "./blog.ts"
import { readSkillDetail } from "./skill.ts"
import {
  deliverPortalEvent,
  handlePortalInternalEventRequest,
  isSupportedPortalInjectedEvent,
  subscribePortalEvents,
  type PortalInjectedEvent,
} from "./events.ts"
import { portalOfficeDir } from "../paths.ts"
import { agentSync } from "./agent-sync.ts"
import { getCachedPortalSnapshot } from "./snapshot.ts"
import { readOfficeLayoutManifest, readOfficeLayoutSpec } from "./office-layout.ts"
import { portalAdminRuntimeUrl, portalRuntimeUrl } from "./runtime-info.ts"
import { buildPortalBranding, resolvePortalLogoFile } from "./branding.ts"
import { buildTeamStatsSnapshot } from "./team-stats.ts"
import { officeRevisionCacheControl } from "./portal-cache.ts"
import { tryServePortalUi } from "./static-ui.ts"
import { gatehouseLog } from "../log.ts"
import { resolveProjectDirectory, withCors } from "./security.ts"
import { fetchAdminReachable, preferredPortalDisplayPort } from "./ports.ts"
import { getActivePortalAdminPort } from "./admin-server.ts"

export type PortalFetchOptions = {
  packageRoot: string
  defaultProjectDirectory: string
  getListenPort: () => number | undefined
  serveStaticUi?: boolean
}

function json(data: unknown, status = 200, cacheControl = "no-store") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
    },
  })
}

function opencodeUrl() {
  return process.env.OPENCODE_URL ?? process.env.OPENCODE_SERVER_URL ?? "http://127.0.0.1:4096"
}

function officeAssetPath(projectDirectory: string, name: string) {
  return path.join(portalOfficeDir(projectDirectory), name)
}

function serveOfficeFile(
  projectDirectory: string,
  name: string,
  contentType: string,
  request: Request,
  revision?: string | null,
) {
  const filePath = officeAssetPath(projectDirectory, name)
  if (!existsSync(filePath)) return withCors(new Response("office layout not generated", { status: 404 }), request)
  return withCors(
    new Response(Bun.file(filePath), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": officeRevisionCacheControl(revision),
      },
    }),
    request,
  )
}

function drainSseMessages(buffer: string) {
  const messages: unknown[] = []
  let rest = buffer
  while (true) {
    const index = rest.indexOf("\n\n")
    if (index === -1) break
    const block = rest.slice(0, index)
    rest = rest.slice(index + 2)
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
    if (!data) continue
    try {
      messages.push(JSON.parse(data) as unknown)
    } catch {
      // ignore malformed chunks
    }
  }
  return { messages, rest }
}

async function proxyOpencodeEvents(projectDirectory: string, request: Request) {
  const encoder = new TextEncoder()
  let cleanup: (() => void) | undefined
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "ping" })}\n\n`))
      const unsubscribe = subscribePortalEvents((event) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      })
      const pingTimer = setInterval(() => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "ping" })}\n\n`))
      }, 8000)
      const stop = () => {
        clearInterval(pingTimer)
        unsubscribe()
      }
      cleanup = stop

      request.signal.addEventListener(
        "abort",
        () => {
          stop()
          controller.close()
        },
        { once: true },
      )

      const url = new URL("/event", opencodeUrl())
      url.searchParams.set("directory", projectDirectory)

      const sync = agentSync(projectDirectory)
      await sync.refreshIndex(opencodeUrl()).catch(() => undefined)

      while (!request.signal.aborted) {
        const upstream = await fetch(url, {
          headers: request.headers.get("Last-Event-ID")
            ? { "Last-Event-ID": request.headers.get("Last-Event-ID")! }
            : undefined,
          signal: request.signal,
        }).catch(() => undefined)

        if (!upstream?.ok || !upstream.body) {
          await Bun.sleep(2000)
          continue
        }

        const reader = upstream.body.getReader()
        const decoder = new TextDecoder()
        let pending = ""
        try {
          while (!request.signal.aborted) {
            const chunk = await reader.read()
            if (chunk.done) break
            pending += decoder.decode(chunk.value, { stream: true })
            const parsed = drainSseMessages(pending)
            pending = parsed.rest
            for (const message of parsed.messages) {
              void sync.handleOpencodeEvent(message, opencodeUrl())
            }
          }
        } catch {
          // client disconnected or upstream closed
        } finally {
          reader.releaseLock()
        }

        if (request.signal.aborted) break
        await Bun.sleep(500)
      }

      stop()
    },
    cancel() {
      cleanup?.()
    },
  })

  return withCors(
    new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    }),
    request,
  )
}

export function isPortalApiPath(pathname: string) {
  return pathname.startsWith("/portal/api/") || pathname === "/portal/events"
}

export function createPortalFetchHandler(options: PortalFetchOptions) {
  const serveStaticUi = options.serveStaticUi ?? true

  return async function handlePortalFetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }), request)

    const projectDirectoryResult = resolveProjectDirectory(url, request, options.defaultProjectDirectory)
    if (!projectDirectoryResult.ok) return withCors(projectDirectoryResult.response, request)
    const projectDirectory = projectDirectoryResult.directory

    if (url.pathname === "/portal/api/health") {
      const listenPort = options.getListenPort() ?? preferredPortalDisplayPort()
      const adminPort = getActivePortalAdminPort()
      const adminReady = adminPort ? await fetchAdminReachable(adminPort) : false
      return withCors(
        json({
          ok: true,
          project_directory: projectDirectory,
          default_project_directory: options.defaultProjectDirectory,
          port: listenPort,
          ...(adminReady && adminPort
            ? {
                admin_port: adminPort,
                admin_url: portalAdminRuntimeUrl(adminPort),
              }
            : {}),
        }),
        request,
      )
    }

    if (url.pathname === "/portal/api/internal/event" && request.method === "POST") {
      const denied = handlePortalInternalEventRequest(request)
      if (denied) return withCors(denied, request)
      const event = (await request.json()) as PortalInjectedEvent
      if (!isSupportedPortalInjectedEvent(event)) {
        return withCors(new Response("unsupported event", { status: 400 }), request)
      }
      deliverPortalEvent(event)
      return withCors(json({ ok: true }), request)
    }

    if (url.pathname === "/portal/api/branding") {
      return withCors(json(buildPortalBranding(projectDirectory, url)), request)
    }

    if (url.pathname === "/portal/api/branding/logo") {
      const logoPath = resolvePortalLogoFile(projectDirectory)
      if (!logoPath) return withCors(new Response("logo not found", { status: 404 }), request)
      const file = Bun.file(logoPath)
      if (!(await file.exists())) return withCors(new Response("logo not found", { status: 404 }), request)
      const ext = path.extname(logoPath).toLowerCase()
      const type =
        ext === ".svg"
          ? "image/svg+xml"
          : ext === ".png"
            ? "image/png"
            : ext === ".jpg" || ext === ".jpeg"
              ? "image/jpeg"
              : ext === ".webp"
                ? "image/webp"
                : ext === ".gif"
                  ? "image/gif"
                  : "application/octet-stream"
      return withCors(new Response(file, { headers: { "Content-Type": type } }), request)
    }

    if (url.pathname === "/portal/api/snapshot") {
      const snapshot = await getCachedPortalSnapshot(projectDirectory, opencodeUrl()).catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        gatehouseLog("warn", `[gatehouse/portal] snapshot failed: ${message}`, {
          projectDirectory,
          title: "Portal",
        })
        return undefined
      })
      if (!snapshot) {
        return withCors(json({ error: "snapshot_unavailable" }, 503), request)
      }
      return withCors(json(snapshot), request)
    }

    if (url.pathname === "/portal/api/blog") {
      const blog = await buildBlogSnapshot(projectDirectory)
      return withCors(json(blog), request)
    }

    if (url.pathname === "/portal/api/team-stats") {
      const stats = await buildTeamStatsSnapshot(projectDirectory, opencodeUrl()).catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        gatehouseLog("warn", `[gatehouse/portal] team-stats failed: ${message}`, {
          projectDirectory,
          title: "Portal",
        })
        return undefined
      })
      if (!stats) return withCors(json({ error: "team_stats_unavailable" }, 503), request)
      return withCors(json(stats), request)
    }

    if (url.pathname === "/portal/api/skill") {
      const domain = url.searchParams.get("domain")?.trim() ?? ""
      const name = url.searchParams.get("name")?.trim() ?? ""
      if (!domain || !name) return withCors(new Response("domain and name required", { status: 400 }), request)
      const detail = await readSkillDetail(projectDirectory, domain, name)
      if (!detail) return withCors(new Response("skill not found", { status: 404 }), request)
      return withCors(json(detail), request)
    }

    if (url.pathname === "/portal/api/office/manifest.json") {
      const manifest = await readOfficeLayoutManifest(projectDirectory)
      if (!manifest) return withCors(new Response("office layout unavailable", { status: 404 }), request)
      const revision = url.searchParams.get("revision")
      return withCors(json(manifest, 200, officeRevisionCacheControl(revision)), request)
    }

    if (url.pathname === "/portal/api/office/map.json") {
      return serveOfficeFile(
        projectDirectory,
        "map.json",
        "application/json; charset=utf-8",
        request,
        url.searchParams.get("revision"),
      )
    }

    if (url.pathname === "/portal/api/office/scene-bg.png") {
      return serveOfficeFile(projectDirectory, "scene-bg.png", "image/png", request, url.searchParams.get("revision"))
    }

    if (url.pathname === "/portal/api/office/collision-tile.png") {
      return serveOfficeFile(
        projectDirectory,
        "collision-tile.png",
        "image/png",
        request,
        url.searchParams.get("revision"),
      )
    }

    if (url.pathname.startsWith("/portal/api/office/assets/objects/")) {
      const name = decodeURIComponent(url.pathname.slice("/portal/api/office/assets/objects/".length))
      if (!name || name.includes("..") || name.includes("/")) {
        return withCors(new Response("invalid object path", { status: 400 }), request)
      }
      return serveOfficeFile(
        projectDirectory,
        path.join("assets", "objects", name),
        "image/png",
        request,
        url.searchParams.get("revision"),
      )
    }

    if (url.pathname === "/portal/api/office/spec.json") {
      const spec = await readOfficeLayoutSpec(projectDirectory)
      if (!spec) return withCors(new Response("office layout spec missing", { status: 404 }), request)
      return withCors(json(spec), request)
    }

    if (url.pathname === "/portal/events") {
      return proxyOpencodeEvents(projectDirectory, request)
    }

    if (serveStaticUi) {
      const staticUi = tryServePortalUi(options.packageRoot, url, request.method)
      if (staticUi) return withCors(staticUi, request)
    }

    return withCors(new Response("not found", { status: 404 }), request)
  }
}

export function portalRuntimeUiUrl(port: number) {
  return portalRuntimeUrl(port)
}
