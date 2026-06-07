import { SNAPSHOT_POLL_MS } from "../portal/poll-intervals.ts"
import { portalProjectDirectory, resolvePortalProjectDirectory, snapshotUrl } from "./project-directory.ts"
import { t } from "../shell/i18n.ts"
import type { PortalSnapshot } from "./types.ts"

const FETCH_TIMEOUT_MS = 8000

export async function loadPortalSnapshot(directory?: string) {
  const resolved = directory ?? portalProjectDirectory() ?? (await resolvePortalProjectDirectory())
  if (!resolved) throw new Error(t("error.noProjectDir"))
  const url = snapshotUrl(resolved)
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) throw new Error(t("error.loadSnapshot", { status: response.status, url }))
  return (await response.json()) as PortalSnapshot
}

export async function loadPortalSnapshotWithRetry(
  maxAttempts = 30,
  intervalMs = 1000,
  onAttempt?: (attempt: number, max: number, error: unknown) => void,
) {
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const snapshot = await loadPortalSnapshot().catch((error) => {
      lastError = error
      onAttempt?.(attempt, maxAttempts, error)
      return undefined
    })
    if (snapshot) return snapshot
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }
  throw lastError ?? new Error(t("error.snapshotUnavailable"))
}

export function startSnapshotPolling(onUpdate: (snapshot: PortalSnapshot) => void, intervalMs = SNAPSHOT_POLL_MS) {
  const tick = async () => {
    const snapshot = await loadPortalSnapshot().catch(() => undefined)
    if (snapshot) onUpdate(snapshot)
  }
  void tick()
  return setInterval(() => void tick(), intervalMs)
}
