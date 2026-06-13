import { portalProjectSlug, skillUrl } from "./project-directory.ts"
import {
  mergeOfflineBundle,
  offlineSkillCacheKey,
  readOfflineSkillDetail,
} from "../portal/offline-cache.ts"
import type { PortalSkill } from "./types.ts"

const FETCH_TIMEOUT_MS = 8000

export type PortalSkillDetail = PortalSkill & {
  markdown: string
}

export async function loadSkillDetail(domain: string, name: string, project?: string) {
  const slug = project ?? portalProjectSlug()
  const cacheKey = offlineSkillCacheKey(domain, name)
  try {
    const response = await fetch(skillUrl(domain, name, slug), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`skill load failed (${response.status})`)
    const detail = (await response.json()) as PortalSkillDetail
    if (slug) mergeOfflineBundle(slug, { skills: { [cacheKey]: detail } })
    return detail
  } catch (error) {
    const cached = slug ? readOfflineSkillDetail(slug, domain, name) : undefined
    if (cached) return cached
    throw error
  }
}
