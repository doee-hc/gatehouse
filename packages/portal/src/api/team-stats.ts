import { t } from "../shell/i18n.ts"
import { mergeOfflineBundle, readOfflineBundle } from "../portal/offline-cache.ts"
import { portalProjectSlug, teamStatsUrl } from "./project-directory.ts"
import type { TeamStatsSnapshot } from "./types.ts"

const FETCH_TIMEOUT_MS = 20_000

export async function loadTeamStatsSnapshot(project?: string) {
  const slug = project ?? portalProjectSlug()
  try {
    const response = await fetch(teamStatsUrl(slug), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(t("error.loadTeamStatsApi", { status: response.status }))
    const snapshot = (await response.json()) as TeamStatsSnapshot
    if (slug) mergeOfflineBundle(slug, { teamStats: snapshot })
    return snapshot
  } catch (error) {
    const cached = slug ? readOfflineBundle(slug)?.teamStats : undefined
    if (cached) return cached
    throw error
  }
}
