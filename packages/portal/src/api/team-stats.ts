import { portalProjectDirectory } from "./project-directory.ts"
import type { TeamStatsSnapshot } from "./types.ts"

const FETCH_TIMEOUT_MS = 20_000

export async function loadTeamStatsSnapshot(directory?: string) {
  const resolved = directory ?? portalProjectDirectory()
  const query = resolved ? `?directory=${encodeURIComponent(resolved)}` : ""
  const response = await fetch(`/portal/api/team-stats${query}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`无法加载团队数据（${response.status}）`)
  return (await response.json()) as TeamStatsSnapshot
}
