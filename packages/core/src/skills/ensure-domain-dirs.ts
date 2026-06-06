import { mkdir } from "node:fs/promises"
import { resolveProjectPath, skillDomainDir } from "../paths.ts"

export async function ensureSkillDomainDirs(projectDirectory: string, domainIds: Iterable<string>) {
  const ensured: string[] = []
  const seen = new Set<string>()
  for (const raw of domainIds) {
    const id = raw.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    await mkdir(resolveProjectPath(projectDirectory, skillDomainDir(id)), { recursive: true })
    ensured.push(id)
  }
  return ensured
}

export function skillDomainIdsFromAssignments(parsed: Record<string, unknown>) {
  return Object.values(parsed).flatMap((value) =>
    typeof value === "string" && value.trim() ? [value.trim()] : [],
  )
}
