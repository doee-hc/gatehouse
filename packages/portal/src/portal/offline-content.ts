import { loadSkillDetail } from "../api/skill.ts"
import type { PortalSkill } from "../api/types.ts"
import { mergeOfflineBundle, offlineSkillCacheKey, readOfflineBundle } from "./offline-cache.ts"

export async function warmClientSkillCache(project: string, skills: PortalSkill[]) {
  const cached = readOfflineBundle(project)?.skills ?? {}
  const missing = skills.filter((skill) => !cached[offlineSkillCacheKey(skill.domain, skill.name)])
  if (missing.length === 0) return

  await Promise.all(
    missing.map((skill) => loadSkillDetail(skill.domain, skill.name, project).catch(() => undefined)),
  )
}

export function mergeOfflineContentFromBundle(
  project: string,
  bundle?: {
    blog?: Parameters<typeof mergeOfflineBundle>[1]["blog"]
    skills?: Parameters<typeof mergeOfflineBundle>[1]["skills"]
  },
) {
  if (!bundle) return
  const patch: Parameters<typeof mergeOfflineBundle>[1] = {}
  if (bundle.blog) patch.blog = bundle.blog
  if (bundle.skills && Object.keys(bundle.skills).length > 0) patch.skills = bundle.skills
  if (Object.keys(patch).length > 0) mergeOfflineBundle(project, patch)
}
