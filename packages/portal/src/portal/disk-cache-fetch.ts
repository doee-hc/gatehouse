import type { OfflineBundle } from "./offline-cache.ts"

const FETCH_TIMEOUT_MS = 8000

export async function fetchOfflineDiskBundle(project?: string) {
  const query = project ? `?project=${encodeURIComponent(project)}` : ""
  const response = await fetch(`/portal/api/offline-cache${query}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch(() => undefined)
  if (!response?.ok) return undefined
  return (await response.json()) as OfflineBundle
}
