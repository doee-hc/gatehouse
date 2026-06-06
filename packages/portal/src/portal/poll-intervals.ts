/** HTTP poll cadence — live agent status comes from /portal/events SSE. */
export const SNAPSHOT_POLL_MS = Number(import.meta.env.GATEHOUSE_SNAPSHOT_POLL_MS) || 10_000
export const BLOG_POLL_MS = 60_000
export const EVENTS_RECONNECT_MS = 10_000
