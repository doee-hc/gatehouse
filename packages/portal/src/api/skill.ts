import { portalProjectSlug, skillUrl } from "./project-directory.ts"
import type { PortalSkill } from "./types.ts"

const FETCH_TIMEOUT_MS = 8000

export type PortalSkillDetail = PortalSkill & {
  markdown: string
}

export async function loadSkillDetail(domain: string, name: string, project?: string) {
  const response = await fetch(skillUrl(domain, name, project ?? portalProjectSlug()), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`skill load failed (${response.status})`)
  return (await response.json()) as PortalSkillDetail
}
