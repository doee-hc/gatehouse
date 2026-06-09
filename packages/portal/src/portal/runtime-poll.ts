import { applyPortalOfficeConfig } from "./office-behavior.ts"
import {
  SNAPSHOT_POLL_MS,
  TEAM_STATS_POLL_MS,
  type PortalDisplayConfig,
} from "./poll-intervals.ts"

let snapshotPollMs = SNAPSHOT_POLL_MS
let teamStatsPollMs = TEAM_STATS_POLL_MS

export function applyPortalDisplayConfig(config?: Pick<PortalDisplayConfig, "snapshot_poll_ms" | "team_stats_poll_ms" | "office">) {
  if (!config) return
  if (Number.isFinite(config.snapshot_poll_ms) && config.snapshot_poll_ms > 0) {
    snapshotPollMs = config.snapshot_poll_ms
  }
  if (Number.isFinite(config.team_stats_poll_ms) && config.team_stats_poll_ms > 0) {
    teamStatsPollMs = config.team_stats_poll_ms
  }
  if (config.office) applyPortalOfficeConfig(config.office)
}

export function resolveSnapshotPollMs() {
  return snapshotPollMs
}

export function resolveTeamStatsPollMs() {
  return teamStatsPollMs
}
