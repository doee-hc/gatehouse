import { offlineCacheUrl } from "./project-directory.ts"
import type { OfflineBundle } from "../portal/offline-cache.ts"

const FETCH_TIMEOUT_MS = 8000

export async function loadOfflineDiskBundle(project?: string) {
  const response = await fetch(offlineCacheUrl(project), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch(() => undefined)
  if (!response?.ok) return undefined
  return (await response.json()) as OfflineBundle
}
