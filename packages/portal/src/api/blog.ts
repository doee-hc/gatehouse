import { BLOG_POLL_MS } from "../portal/poll-intervals.ts"
import { blogUrl, portalProjectSlug } from "./project-directory.ts"
import type { BlogSnapshot } from "./types.ts"

const FETCH_TIMEOUT_MS = 8000

export async function loadBlogSnapshot(project?: string) {
  const response = await fetch(blogUrl(project ?? portalProjectSlug()), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`无法加载 blog（${response.status}）`)
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
