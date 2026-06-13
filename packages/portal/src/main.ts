import { loadPortalBranding } from "./api/branding.ts"
import { loadBlogSnapshot, startBlogPolling } from "./api/blog.ts"
import { loadPortalDisplayConfig } from "./api/display-config.ts"
import { loadOfflineDiskBundle } from "./api/offline-cache.ts"
import { portalProjectSlug, resolvePortalProjectSlug, setPortalProjectSlug } from "./api/project-directory.ts"
import { loadPortalSnapshotWithRetry, startSnapshotPolling } from "./api/snapshot.ts"
import { isBackendConnected, setBackendConnected } from "./portal/connection.ts"
import { applySnapshotUpdate } from "./portal/snapshot-sync.ts"
import { BLOG_POLL_MS } from "./portal/poll-intervals.ts"
import { applyPortalDisplayConfig, resolveSnapshotPollMs } from "./portal/runtime-poll.ts"
import { mergeOfflineBundle, readOfflineBundle, type OfflineBundle } from "./portal/offline-cache.ts"
import { logBlogSnapshotDiff } from "./portal/snapshot-events.ts"
import { getBlogSnapshot, setBlogSnapshot, setPortalSnapshot } from "./portal/state.ts"
import { startPortalLiveSync } from "./portal/live-sync.ts"
import { startOfficeGame } from "./office/game.ts"
import { showPortalError } from "./shell/error.ts"
import { applyPortalBranding } from "./shell/branding.ts"
import { initShell } from "./shell/index.ts"
import { renderBlog } from "./shell/blog.ts"
import { logEvent } from "./shell/event-log.ts"
import { t } from "./shell/i18n.ts"

function setLoadingStatus(text: string) {
  const label = document.getElementById("nav-status-label")
  if (label) label.textContent = text
}

function mergeDiskBundle(project: string, disk?: OfflineBundle) {
  if (!disk) return
  mergeOfflineBundle(project, disk)
}

async function boot() {
  const project = portalProjectSlug() ?? (await resolvePortalProjectSlug())
  const cached = project ? readOfflineBundle(project) : undefined

  if (!project) {
    throw new Error(t("error.noProjectDir"))
  }

  setPortalProjectSlug(project)
  setLoadingStatus(t("nav.connecting"))

  const maxAttempts = cached?.snapshot ? 3 : 30
  let snapshot = await loadPortalSnapshotWithRetry(maxAttempts, 1000, (attempt, max, error) => {
    const detail = error instanceof Error ? error.message : String(error)
    setLoadingStatus(t("nav.waitingApi", { attempt, max }))
    console.warn(`[portal] snapshot attempt ${attempt}/${max}:`, detail)
  }).catch(() => undefined)

  let offline = false
  if (snapshot) {
    setBackendConnected(true)
    mergeOfflineBundle(project, { snapshot })
  } else {
    const diskBundle = await loadOfflineDiskBundle(project).catch(() => undefined)
    mergeDiskBundle(project, diskBundle)
    const fallback = readOfflineBundle(project)
    if (fallback?.snapshot) {
      snapshot = fallback.snapshot
      offline = true
      setBackendConnected(false)
      setLoadingStatus(t("nav.offlineCache"))
      console.warn("[portal] using offline snapshot cache")
    } else {
      throw new Error(t("error.snapshotUnavailable"))
    }
  }

  const offlineSources = readOfflineBundle(project)
  const [blog, branding, displayConfig] = await Promise.all([
    loadBlogSnapshot(project)
      .then((next) => {
        mergeOfflineBundle(project, { blog: next })
        return next
      })
      .catch(() => offlineSources?.blog),
    loadPortalBranding(project).then((next) => {
      if (next) mergeOfflineBundle(project, { branding: next })
      return next ?? offlineSources?.branding
    }),
    loadPortalDisplayConfig(project)
      .then((next) => {
        if (next) mergeOfflineBundle(project, { displayConfig: next })
        return next
      })
      .catch(() => offlineSources?.displayConfig),
  ])
  applyPortalDisplayConfig(displayConfig)

  applyPortalBranding(branding)
  setPortalSnapshot(snapshot)
  initShell(() => startOfficeGame(), snapshot)

  if (!offline) startPortalLiveSync()

  startSnapshotPolling(
    (next) => {
      const wasOffline = !isBackendConnected()
      setBackendConnected(true)
      mergeOfflineBundle(project, { snapshot: next })
      applySnapshotUpdate(next)
      if (wasOffline) {
        startPortalLiveSync()
        logEvent(() => t("event.portalReconnected"), "evt-live")
      }
    },
    resolveSnapshotPollMs(),
    () => {
      if (!isBackendConnected()) return
      setBackendConnected(false)
      logEvent(() => t("event.portalDisconnected"), "evt-warn")
    },
  )
  applySnapshotUpdate(snapshot)

  if (offline) {
    logEvent(() => t("event.portalOffline"), "evt-warn")
  }

  if (blog) setBlogSnapshot(blog)

  startBlogPolling((next) => {
    logBlogSnapshotDiff(getBlogSnapshot(), next)
    mergeOfflineBundle(project, { blog: next })
    setBlogSnapshot(next)
    renderBlog(next)
  }, BLOG_POLL_MS)
}

void boot().catch((error) => {
  console.error("[portal] boot failed", error)
  showPortalError(error)
})
