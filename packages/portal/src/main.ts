import { loadPortalBranding } from "./api/branding.ts"
import { loadBlogSnapshot, startBlogPolling } from "./api/blog.ts"
import { portalProjectSlug, resolvePortalProjectSlug } from "./api/project-directory.ts"
import { loadPortalSnapshotWithRetry, startSnapshotPolling } from "./api/snapshot.ts"
import { applySnapshotUpdate } from "./portal/snapshot-sync.ts"
import { BLOG_POLL_MS, SNAPSHOT_POLL_MS } from "./portal/poll-intervals.ts"
import { setBlogSnapshot, setPortalSnapshot } from "./portal/state.ts"
import { startPortalLiveSync } from "./portal/live-sync.ts"
import { startOfficeGame } from "./office/game.ts"
import { showPortalError } from "./shell/error.ts"
import { applyPortalBranding } from "./shell/branding.ts"
import { initShell } from "./shell/index.ts"
import { renderBlog } from "./shell/blog.ts"
import { t } from "./shell/i18n.ts"

function setLoadingStatus(text: string) {
  const label = document.getElementById("nav-status-label")
  if (label) label.textContent = text
}

async function boot() {
  const project = portalProjectSlug() ?? (await resolvePortalProjectSlug())
  if (!project) {
    throw new Error(t("error.noProjectDir"))
  }

  setLoadingStatus(t("nav.connecting"))

  const snapshot = await loadPortalSnapshotWithRetry(30, 1000, (attempt, max, error) => {
    const detail = error instanceof Error ? error.message : String(error)
    setLoadingStatus(t("nav.waitingApi", { attempt, max }))
    console.warn(`[portal] snapshot attempt ${attempt}/${max}:`, detail)
  })

  const [blog, branding] = await Promise.all([
    loadBlogSnapshot(project).catch(() => undefined),
    loadPortalBranding(project).catch(() => undefined),
  ])

  applyPortalBranding(branding)
  setPortalSnapshot(snapshot)
  initShell(() => startOfficeGame(), snapshot)

  startPortalLiveSync()
  startSnapshotPolling((next) => {
    applySnapshotUpdate(next)
  }, SNAPSHOT_POLL_MS)
  applySnapshotUpdate(snapshot)

  if (blog) setBlogSnapshot(blog)

  startBlogPolling((next) => {
    setBlogSnapshot(next)
    renderBlog(next)
  }, BLOG_POLL_MS)
}

void boot().catch((error) => {
  console.error("[portal] boot failed", error)
  showPortalError(error)
})
