import { BLOG_POLL_MS } from "../portal/poll-intervals.ts"
import { t } from "../shell/i18n.ts"
import { portalProjectDirectory } from "./project-directory.ts"
import type { BlogSnapshot } from "./types.ts"

const FETCH_TIMEOUT_MS = 8000

export async function loadBlogSnapshot(directory?: string) {
  const resolved = directory ?? portalProjectDirectory()
  const query = resolved ? `?directory=${encodeURIComponent(resolved)}` : ""
  const response = await fetch(`/portal/api/blog${query}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) throw new Error(t("error.loadBlog", { status: response.status }))
  return (await response.json()) as BlogSnapshot
}

export function startBlogPolling(onUpdate: (blog: BlogSnapshot) => void, intervalMs = BLOG_POLL_MS) {
  const tick = async () => {
    const blog = await loadBlogSnapshot().catch(() => undefined)
    if (blog) onUpdate(blog)
  }
  void tick()
  return setInterval(() => void tick(), intervalMs)
}
