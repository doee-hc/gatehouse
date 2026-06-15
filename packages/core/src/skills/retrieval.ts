import path from "node:path"
import { resolveProjectPath, skillDomainDir } from "../paths.ts"
import { SKILL_PIPELINE } from "./config.ts"
import { textSimilarity, tokenize } from "./text-similarity.ts"
import { listSkillSlugsInDomain } from "../retro/skill-kickoff.ts"
import { recordSkillRetrieval } from "./utility.ts"

export type SkillCatalogEntry = {
  slug: string
  relPath: string
  description: string
  score: number
}

function parseDescription(markdown: string) {
  const match = markdown.match(/^---[\s\S]*?description:\s*(.+?)\s*\n[\s\S]*?---/m)
  return match?.[1]?.trim() ?? ""
}

export async function loadDomainSkillCatalog(projectDirectory: string, domain: string) {
  const slugs = await listSkillSlugsInDomain(projectDirectory, domain)
  const domainAbs = resolveProjectPath(projectDirectory, skillDomainDir(domain))
  const entries: Array<{ slug: string; relPath: string; text: string; description: string }> = []
  for (const slug of slugs) {
    const relPath = path.posix.join(skillDomainDir(domain), slug, "SKILL.md")
    const abs = path.join(domainAbs, slug, "SKILL.md")
    const markdown = await Bun.file(abs).text()
    entries.push({
      slug,
      relPath,
      text: `${slug} ${parseDescription(markdown)} ${markdown.slice(0, 1200)}`,
      description: parseDescription(markdown),
    })
  }
  return entries
}

export async function selectSkillsForTask(input: {
  projectDirectory: string
  domain: string
  query: string
  topK?: number
  missionId?: string
}) {
  const topK = input.topK ?? SKILL_PIPELINE.retrievalTopK
  const catalog = await loadDomainSkillCatalog(input.projectDirectory, input.domain)
  if (catalog.length === 0) return [] as SkillCatalogEntry[]

  const queryText = tokenize(input.query).join(" ")
  const ranked = catalog
    .map((entry) => ({
      slug: entry.slug,
      relPath: entry.relPath,
      description: entry.description,
      score: textSimilarity(queryText, entry.text),
    }))
    .sort((a, b) => b.score - a.score)

  const selected = ranked.slice(0, Math.min(topK, ranked.length))
  for (const item of selected) {
    await recordSkillRetrieval({
      projectDirectory: input.projectDirectory,
      domain: input.domain,
      slug: item.slug,
      ...(input.missionId && { missionId: input.missionId }),
    })
  }
  return selected
}

export function formatRetrievedSkillCatalog(entries: SkillCatalogEntry[], locale: "zh" | "en") {
  if (entries.length === 0) {
    return locale === "zh" ? "（暂无匹配 skill）" : "(no matching skills)"
  }
  return entries
    .map((entry) => `- \`${entry.slug}\` — ${entry.description || entry.slug} (score=${entry.score.toFixed(2)})`)
    .join("\n")
}
