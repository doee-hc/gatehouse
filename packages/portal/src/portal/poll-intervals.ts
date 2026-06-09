import type { PortalOfficeConfig } from "./office-behavior.ts"

export type { PortalOfficeConfig }

export type PortalDisplayConfig = {
  snapshot_poll_ms: number
  team_stats_poll_ms: number
  office: PortalOfficeConfig
}

/** HTTP poll cadence — live agent status comes from /portal/events SSE. */
export const SNAPSHOT_POLL_MS = Number(import.meta.env.GATEHOUSE_SNAPSHOT_POLL_MS) || 10_000
export const SNAPSHOT_POLL_HIDDEN_MS = 30_000

export const BLOG_POLL_MS = 60_000
export const BLOG_POLL_HIDDEN_MS = 120_000

export const TEAM_STATS_POLL_MS = Number(import.meta.env.GATEHOUSE_TEAM_STATS_POLL_MS) || 8_000
export const TEAM_STATS_POLL_HIDDEN_MS = 60_000

export const EVENTS_RECONNECT_MS = 10_000
export const EVENTS_RECONNECT_MAX_MS = 60_000
