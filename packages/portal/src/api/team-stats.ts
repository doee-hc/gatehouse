import { t } from "../shell/i18n.ts"
import { portalProjectSlug, teamStatsUrl } from "./project-directory.ts"
import type { TeamStatsSnapshot } from "./types.ts"

const FETCH_TIMEOUT_MS = 20_000

export async function loadTeamStatsSnapshot(project?: string) {
  const response = await fetch(teamStatsUrl(project ?? portalProjectSlug()), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(t("error.loadTeamStatsApi", { status: response.status }))
  return (await response.json()) as TeamStatsSnapshot
}
