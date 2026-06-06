import { portalProjectDirectory } from "./project-directory.ts"
import type { PortalSkill } from "./types.ts"

const FETCH_TIMEOUT_MS = 8000

export type PortalSkillDetail = PortalSkill & {
  markdown: string
}

export async function loadSkillDetail(domain: string, name: string, directory?: string) {
  const resolved = directory ?? portalProjectDirectory()
  const params = new URLSearchParams({ domain, name })
  if (resolved) params.set("directory", resolved)
  const response = await fetch(`/portal/api/skill?${params}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`skill load failed (${response.status})`)
  return (await response.json()) as PortalSkillDetail
}
