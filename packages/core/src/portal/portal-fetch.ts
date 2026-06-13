import path from "node:path"
import { existsSync } from "node:fs"
import { buildBlogSnapshot, invalidateBlogSnapshotCache } from "./blog.ts"
import { readSkillDetail } from "./skill.ts"
import {
  deliverPortalEvent,
  handlePortalInternalEventRequest,
  isSupportedPortalInjectedEvent,
  subscribePortalEvents,
  type PortalInjectedEvent,
} from "./events.ts"
import { portalOfficeDir } from "../paths.ts"
import { getCachedPortalSnapshot } from "./snapshot.ts"
import { readOfficeLayoutManifest, readOfficeLayoutSpec } from "./office-layout.ts"
import { portalRuntimeUrl } from "./runtime-info.ts"
import { buildPortalBranding, resolvePortalLogoFile } from "./branding.ts"
import { buildTeamStatsSnapshot } from "./team-stats.ts"
import { officeRevisionCacheControl } from "./portal-cache.ts"
import { tryServePortalUi } from "./static-ui.ts"
import { gatehouseLog } from "../log.ts"
import { resolveProjectDirectory, withCors } from "./security.ts"
import {
  toBrowserBlog,
  toBrowserSkillDetail,
  toBrowserSnapshot,
  toBrowserTeamStats,
} from "./browser-dto.ts"
import { isOpencodeBridgeRunning } from "./opencode-bridge.ts"
import { resolvePortalProjectSlug } from "./portal-project.ts"
import { portalSnapshotCacheAgeMs } from "./snapshot.ts"
import { getPortalDisplaySettings, toBrowserDisplayConfig } from "./portal-display-settings.ts"
import {
  mergePortalOfflineDiskCache,
  portalOfflineSkillCacheKey,
  readPortalOfflineDiskBundle,
  readPortalOfflineDiskSkillDetail,
  refreshPortalOfflineSkillsCache,
} from "./offline-disk-cache.ts"
import { acquirePortalSseConnection, portalSseActiveCount } from "./sse-registry.ts"

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

async function probeOpencodeReachable(baseUrl: string) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health`, {
    signal: AbortSignal.timeout(1500),
  }).catch(() => undefined)
  return response?.ok === true
}

function streamPortalEvents(request: Request) {
  const slot = acquirePortalSseConnection()
  if (!slot.ok) {
    return new Response(JSON.stringify({ error: "sse_capacity_exceeded" }), {
      status: 503,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": "30",
      },
    })
  }

  const encoder = new TextEncoder()
  let cleanup: (() => void) | undefined
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "ping" })}\n\n`))
      const unsubscribe = subscribePortalEvents((event) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          // stream closed
        }
      })
      const pingTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "ping" })}\n\n`))
        } catch {
          // stream closed
        }
      }, 8000)
      const stop = () => {
        clearInterval(pingTimer)
        unsubscribe()
        slot.release()
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
    },
    cancel() {
      cleanup?.()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
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
      const opencode = opencodeUrl()
      return withCors(
        json({
          ok: true,
          project: resolvePortalProjectSlug(projectDirectory),
          opencode_reachable: await probeOpencodeReachable(opencode),
          bridge_running: isOpencodeBridgeRunning(),
          sse_active: portalSseActiveCount(),
          snapshot_cache_age_ms: portalSnapshotCacheAgeMs(),
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

    if (url.pathname === "/portal/api/internal/blog-invalidate" && request.method === "POST") {
      const denied = handlePortalInternalEventRequest(request)
      if (denied) return withCors(denied, request)
      invalidateBlogSnapshotCache()
      return withCors(json({ ok: true }), request)
    }

    if (url.pathname === "/portal/api/display-config") {
      const displayConfig = toBrowserDisplayConfig(getPortalDisplaySettings())
      void mergePortalOfflineDiskCache(projectDirectory, { displayConfig })
      return withCors(json(displayConfig), request)
    }

    if (url.pathname === "/portal/api/branding") {
      const branding = buildPortalBranding(projectDirectory, url)
      void mergePortalOfflineDiskCache(projectDirectory, { branding })
      return withCors(json(branding), request)
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

    if (url.pathname === "/portal/api/offline-cache") {
      const bundle = await readPortalOfflineDiskBundle(projectDirectory)
      if (!bundle?.snapshot) {
        return withCors(json({ error: "offline_cache_unavailable" }, 503), request)
      }
      return withCors(json(bundle), request)
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
      if (snapshot) {
        const browserSnapshot = toBrowserSnapshot(projectDirectory, snapshot)
        void mergePortalOfflineDiskCache(projectDirectory, { snapshot: browserSnapshot })
        void refreshPortalOfflineSkillsCache(projectDirectory, snapshot.skills)
        return withCors(json(browserSnapshot), request)
      }
      const cached = (await readPortalOfflineDiskBundle(projectDirectory))?.snapshot
      if (cached) return withCors(json(cached), request)
      return withCors(json({ error: "snapshot_unavailable" }, 503), request)
    }

    if (url.pathname === "/portal/api/blog") {
      const blog = await buildBlogSnapshot(projectDirectory).catch(() => undefined)
      if (blog) {
        const browserBlog = toBrowserBlog(projectDirectory, blog)
        void mergePortalOfflineDiskCache(projectDirectory, { blog: browserBlog })
        return withCors(json(browserBlog), request)
      }
      const cached = (await readPortalOfflineDiskBundle(projectDirectory))?.blog
      if (cached) return withCors(json(cached), request)
      return withCors(new Response("blog unavailable", { status: 503 }), request)
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
      if (stats) {
        const browserStats = toBrowserTeamStats(projectDirectory, stats)
        void mergePortalOfflineDiskCache(projectDirectory, { teamStats: browserStats })
        return withCors(json(browserStats), request)
      }
      const cached = (await readPortalOfflineDiskBundle(projectDirectory))?.teamStats
      if (cached) return withCors(json(cached), request)
      return withCors(json({ error: "team_stats_unavailable" }, 503), request)
    }

    if (url.pathname === "/portal/api/skill") {
      const domain = url.searchParams.get("domain")?.trim() ?? ""
      const name = url.searchParams.get("name")?.trim() ?? ""
      if (!domain || !name) return withCors(new Response("domain and name required", { status: 400 }), request)
      const detail = await readSkillDetail(projectDirectory, domain, name)
      if (detail) {
        const browserDetail = toBrowserSkillDetail(detail)
        void mergePortalOfflineDiskCache(projectDirectory, {
          skills: { [portalOfflineSkillCacheKey(domain, name)]: browserDetail },
        })
        return withCors(json(browserDetail), request)
      }
      const cached = await readPortalOfflineDiskSkillDetail(projectDirectory, domain, name)
      if (cached) return withCors(json(cached), request)
      return withCors(new Response("skill not found", { status: 404 }), request)
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
      return withCors(streamPortalEvents(request), request)
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
