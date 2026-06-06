import path from "node:path"
import { gatehouseRoot } from "../paths.ts"
import type { PortalSkill } from "./snapshot.ts"

export type PortalSkillDetail = PortalSkill & {
  markdown: string
}

const SKILL_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

function skillFilePath(projectDirectory: string, domain: string, name: string) {
  if (!SKILL_SLUG.test(domain) || !SKILL_SLUG.test(name)) return undefined
  const abs = path.resolve(gatehouseRoot(projectDirectory), "skills", "by-domain", domain, name, "SKILL.md")
  const root = path.resolve(gatehouseRoot(projectDirectory), "skills", "by-domain")
  if (!abs.startsWith(`${root}${path.sep}`)) return undefined
  return abs
}

const skillDetailCache = new Map<string, { mtimeMs: number; data: PortalSkillDetail }>()

function skillDetailCacheKey(projectDirectory: string, domain: string, name: string) {
  return `${projectDirectory}\0${domain}\0${name}`
}

export async function readSkillDetail(projectDirectory: string, domain: string, name: string) {
  const filePath = skillFilePath(projectDirectory, domain, name)
  if (!filePath) return undefined
  const file = Bun.file(filePath)
  if (!(await file.exists())) return undefined
  const stat = await file.stat()
  const cacheKey = skillDetailCacheKey(projectDirectory, domain, name)
  const cached = skillDetailCache.get(cacheKey)
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.data
  const data = {
    name,
    domain,
    path: path.posix.join(".gatehouse", "skills", "by-domain", domain, name, "SKILL.md"),
    markdown: await file.text(),
  } satisfies PortalSkillDetail
  skillDetailCache.set(cacheKey, { mtimeMs: stat.mtimeMs, data })
  return data
}

export function clearSkillDetailCacheForTests() {
  skillDetailCache.clear()
}
