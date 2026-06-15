import path from "node:path"
import { gatehouseRoot, skillDomainDir } from "../paths.ts"
import { resolveProjectPath } from "../paths.ts"
import { SKILL_PIPELINE } from "./config.ts"

export type SkillUtilityEntry = {
  retrieval_count: number
  extract_count: number
  verify_pass_count: number
  last_retrieved_at?: string
  last_extract_at?: string
  missions_used: string[]
}

export type SkillUtilityDoc = {
  schema_version: 1
  updated_at: string
  skills: Record<string, SkillUtilityEntry>
}

function utilityPath(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "skills", "utility.json")
}

export function skillUtilityKey(domain: string, slug: string) {
  return `${domain}/${slug}`
}

export async function readSkillUtility(projectDirectory: string): Promise<SkillUtilityDoc> {
  const file = Bun.file(utilityPath(projectDirectory))
  if (!(await file.exists())) {
    return { schema_version: 1, updated_at: new Date().toISOString(), skills: {} }
  }
  const raw = await file.json()
  if (typeof raw !== "object" || raw === null) {
    return { schema_version: 1, updated_at: new Date().toISOString(), skills: {} }
  }
  const doc = raw as Partial<SkillUtilityDoc>
  return {
    schema_version: 1,
    updated_at: typeof doc.updated_at === "string" ? doc.updated_at : new Date().toISOString(),
    skills: typeof doc.skills === "object" && doc.skills !== null ? (doc.skills as Record<string, SkillUtilityEntry>) : {},
  }
}

async function writeSkillUtility(projectDirectory: string, doc: SkillUtilityDoc) {
  await Bun.write(utilityPath(projectDirectory), JSON.stringify({ ...doc, updated_at: new Date().toISOString() }, null, 2))
}

function bumpEntry(entry: SkillUtilityEntry | undefined): SkillUtilityEntry {
  return {
    retrieval_count: entry?.retrieval_count ?? 0,
    extract_count: entry?.extract_count ?? 0,
    verify_pass_count: entry?.verify_pass_count ?? 0,
    ...(entry?.last_retrieved_at && { last_retrieved_at: entry.last_retrieved_at }),
    ...(entry?.last_extract_at && { last_extract_at: entry.last_extract_at }),
    missions_used: entry?.missions_used ?? [],
  }
}

export async function recordSkillRetrieval(input: {
  projectDirectory: string
  domain: string
  slug: string
  missionId?: string
}) {
  const doc = await readSkillUtility(input.projectDirectory)
  const key = skillUtilityKey(input.domain, input.slug)
  const entry = bumpEntry(doc.skills[key])
  entry.retrieval_count += 1
  entry.last_retrieved_at = new Date().toISOString()
  if (input.missionId && !entry.missions_used.includes(input.missionId)) {
    entry.missions_used = [...entry.missions_used, input.missionId].slice(-20)
  }
  doc.skills[key] = entry
  await writeSkillUtility(input.projectDirectory, doc)
}

export async function recordSkillExtract(input: {
  projectDirectory: string
  domain: string
  slug: string
  missionId: string
}) {
  const doc = await readSkillUtility(input.projectDirectory)
  const key = skillUtilityKey(input.domain, input.slug)
  const entry = bumpEntry(doc.skills[key])
  entry.extract_count += 1
  entry.last_extract_at = new Date().toISOString()
  if (!entry.missions_used.includes(input.missionId)) {
    entry.missions_used = [...entry.missions_used, input.missionId].slice(-20)
  }
  doc.skills[key] = entry
  await writeSkillUtility(input.projectDirectory, doc)
}

export async function recordSkillVerifyPass(input: {
  projectDirectory: string
  domain: string
  slug: string
}) {
  const doc = await readSkillUtility(input.projectDirectory)
  const key = skillUtilityKey(input.domain, input.slug)
  const entry = bumpEntry(doc.skills[key])
  entry.verify_pass_count += 1
  doc.skills[key] = entry
  await writeSkillUtility(input.projectDirectory, doc)
}

export async function archiveLowUtilitySkills(projectDirectory: string) {
  const doc = await readSkillUtility(projectDirectory)
  const archived: string[] = []
  for (const [key, entry] of Object.entries(doc.skills)) {
    if (entry.extract_count < SKILL_PIPELINE.utilityArchiveMinExtracts) continue
    if (entry.retrieval_count > 0) continue
    if (entry.verify_pass_count > 0 && entry.extract_count <= 1) continue
    const [domain, slug] = key.split("/")
    if (!domain || !slug) continue
    const active = resolveProjectPath(projectDirectory, path.join(skillDomainDir(domain), slug, "SKILL.md"))
    const archive = resolveProjectPath(
      projectDirectory,
      path.join(".gatehouse", "skills", "by-domain", `${domain}-archived`, slug, "SKILL.md"),
    )
    if (!(await Bun.file(active).exists())) continue
    await Bun.$`mkdir -p ${path.dirname(archive)}`.quiet()
    await Bun.write(archive, await Bun.file(active).text())
    await Bun.$`rm -rf ${path.dirname(active)}`.quiet()
    delete doc.skills[key]
    archived.push(key)
  }
  if (archived.length > 0) await writeSkillUtility(projectDirectory, doc)
  return archived
}
