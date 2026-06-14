import type { OfflineBundle } from "./offline-cache.ts"

const FETCH_TIMEOUT_MS = 8000
const STATIC_OFFLINE_CACHE_URL = "/offline-cache/bundle.json"

async function fetchJson(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).catch(() => undefined)
  if (!response?.ok) return undefined
  return (await response.json()) as OfflineBundle
}

export async function fetchOfflineDiskBundle(project?: string) {
  const query = project ? `?project=${encodeURIComponent(project)}` : ""
  const fromApi = await fetchJson(`/portal/api/offline-cache${query}`)
  if (fromApi?.snapshot) return fromApi

  const fromStatic = await fetchJson(STATIC_OFFLINE_CACHE_URL)
  if (!fromStatic?.snapshot) return undefined
  if (project && fromStatic.snapshot.project !== project) return undefined
  return fromStatic
}
