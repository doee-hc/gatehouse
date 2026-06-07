import { gatehouseLog } from "../log.ts"
import { DEFAULT_PORTAL_DISPLAY_PORT } from "./defaults.ts"
import { readDisplayPortalApiFromRuntime } from "./ports.ts"
import { portalInternalToken } from "./security.ts"

function portalApiUrl(projectDirectory: string) {
  if (process.env.GATEHOUSE_PORTAL_API) return process.env.GATEHOUSE_PORTAL_API.replace(/\/$/, "")
  const fromRuntime = readDisplayPortalApiFromRuntime(projectDirectory)
  if (fromRuntime) return fromRuntime
  if (process.env.GATEHOUSE_PORTAL_URL) return process.env.GATEHOUSE_PORTAL_URL.replace(/\/$/, "")
  const port = process.env.GATEHOUSE_PORTAL_PORT ?? String(DEFAULT_PORTAL_DISPLAY_PORT)
  return `http://127.0.0.1:${port}`
}

export async function requestPortalBlogCacheRefresh(projectDirectory: string) {
  const response = await fetch(`${portalApiUrl(projectDirectory)}/portal/api/internal/blog-invalidate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Gatehouse-Portal-Internal-Token": portalInternalToken(),
    },
    signal: AbortSignal.timeout(800),
  }).catch((error) => {
    gatehouseLog(
      "warn",
      `[gatehouse/portal] blog cache refresh failed: ${error instanceof Error ? error.message : error}`,
      { projectDirectory, title: "Portal" },
    )
    return undefined
  })

  if (!response) return false
  if (response.ok) return true

  gatehouseLog("warn", `[gatehouse/portal] blog cache refresh rejected (${response.status})`, {
    projectDirectory,
    title: "Portal",
  })
  return false
}
