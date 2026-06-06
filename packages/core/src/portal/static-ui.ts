import { existsSync } from "node:fs"
import path from "node:path"
import { gatehousePortalUiDir } from "../setup/package.ts"

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
}

function contentType(filePath: string) {
  return MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream"
}

function safeJoin(root: string, urlPath: string) {
  const decoded = decodeURIComponent(urlPath)
  const relative = decoded.startsWith("/") ? decoded.slice(1) : decoded
  if (!relative || relative.includes("..")) return
  const resolved = path.resolve(root, relative)
  if (!resolved.startsWith(root)) return
  return resolved
}

export function tryServePortalAdminUi(packageRoot: string, url: URL, method: string) {
  if (method !== "GET" && method !== "HEAD") return
  const uiRoot = gatehousePortalUiDir(packageRoot)
  if (!existsSync(path.join(uiRoot, "admin.html"))) return

  let pathname = url.pathname
  if (pathname === "/admin" || pathname === "/admin/") pathname = "/admin.html"
  if (pathname !== "/admin.html") return

  const filePath = safeJoin(uiRoot, pathname)
  if (!filePath || !existsSync(filePath)) return
  if (method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: { "Content-Type": contentType(filePath) },
    })
  }
  return new Response(Bun.file(filePath), { headers: { "Content-Type": contentType(filePath) } })
}

export function tryServePortalUi(packageRoot: string, url: URL, method: string) {
  if (method !== "GET" && method !== "HEAD") return
  const uiRoot = gatehousePortalUiDir(packageRoot)
  if (!existsSync(path.join(uiRoot, "index.html"))) return

  let pathname = url.pathname === "/" ? "/index.html" : url.pathname
  if (pathname === "/admin" || pathname === "/admin/" || pathname === "/admin.html") return
  const filePath = safeJoin(uiRoot, pathname)
  if (filePath && existsSync(filePath) && !filePath.endsWith("/")) {
    const file = Bun.file(filePath)
    if (method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: { "Content-Type": contentType(filePath) },
      })
    }
    return new Response(file, { headers: { "Content-Type": contentType(filePath) } })
  }

  const indexPath = path.join(uiRoot, "index.html")
  if (!existsSync(indexPath)) return
  if (method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  }
  return new Response(Bun.file(indexPath), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}
