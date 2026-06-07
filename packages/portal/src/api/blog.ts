import { BLOG_POLL_HIDDEN_MS, BLOG_POLL_MS } from "../portal/poll-intervals.ts"
import { startAdaptivePolling } from "../portal/poll-scheduler.ts"
import { t } from "../shell/i18n.ts"
import { blogUrl, portalProjectSlug } from "./project-directory.ts"
import type { BlogSnapshot } from "./types.ts"

const FETCH_TIMEOUT_MS = 8000

export async function loadBlogSnapshot(project?: string) {
  const response = await fetch(blogUrl(project ?? portalProjectSlug()), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(t("error.loadBlog", { status: response.status }))
  return (await response.json()) as BlogSnapshot
}

export function startBlogPolling(onUpdate: (blog: BlogSnapshot) => void, intervalMs = BLOG_POLL_MS) {
  return startAdaptivePolling({
    intervalMs,
    hiddenIntervalMs: BLOG_POLL_HIDDEN_MS,
    run: async () => {
      const blog = await loadBlogSnapshot().catch(() => undefined)
      if (blog) onUpdate(blog)
    },
  })
}
