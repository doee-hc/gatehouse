import path from "node:path"
import { stat } from "node:fs/promises"
import { resolveProjectPath, skillDomainDir } from "../paths.ts"
import { SKILL_PIPELINE, SKILL_PRODUCT_TOKENS } from "./config.ts"
import { tokenize, textSimilarity } from "./text-similarity.ts"

export type SkillGateIssue = {
  code: string
  message: string
  skill_path?: string
  similar_to?: string
  similarity?: number
}

export type SkillGateResult = {
  ok: boolean
  issues: SkillGateIssue[]
  new_skill_paths: string[]
}

function stripFrontmatter(markdown: string) {
  return markdown.replace(/^---[\s\S]*?---\s*/m, "")
}

export function productNameDensity(body: string) {
  const tokens = tokenize(body)
  if (tokens.length === 0) return { density: 0, hits: 0 }
  let hits = 0
  for (const token of tokens) {
    if (SKILL_PRODUCT_TOKENS.has(token)) hits += 1
  }
  return { density: hits / tokens.length, hits }
}

export function abstractFrameworkScore(body: string) {
  const stripped = stripFrontmatter(body)
  const { density, hits } = productNameDensity(stripped)
  const withoutProducts = tokenize(
    stripped.replace(/\b(claude|codex|cursor|copilot|openai|anthropic|github|windsurf|devin|fable|frontiercode|ultracode|dynamic workflows?)\b/gi, ""),
  )
  const frameworkTokens = withoutProducts.filter((token) =>
    ["paradigm", "framework", "dimension", "analysis", "method", "spectrum", "compare", "evaluate", "research"].includes(token),
  )
  const frameworkRatio = withoutProducts.length > 0 ? frameworkTokens.length / withoutProducts.length : 0
  return { density, hits, frameworkRatio, tokenCount: withoutProducts.length }
}

export async function listDomainSkillBodies(projectDirectory: string, domain: string) {
  const domainAbs = resolveProjectPath(projectDirectory, skillDomainDir(domain))
  const domainStat = await stat(domainAbs).catch(() => undefined)
  if (!domainStat?.isDirectory()) return []
  const glob = new Bun.Glob("*/SKILL.md")
  const entries: Array<{ slug: string; relPath: string; body: string }> = []
  for await (const relative of glob.scan({ cwd: domainAbs, onlyFiles: true })) {
    const slash = relative.indexOf("/")
    if (slash <= 0) continue
    const slug = relative.slice(0, slash)
    const relPath = path.posix.join(skillDomainDir(domain), slug, "SKILL.md")
    const body = await Bun.file(path.join(domainAbs, slug, "SKILL.md")).text()
    entries.push({ slug, relPath, body })
  }
  return entries
}

export function parseSkillPathsFromExtractSummary(markdown: string, domain: string) {
  const prefix = skillDomainDir(domain)
  const paths = new Set<string>()
  for (const match of markdown.matchAll(/`([^`]+\/SKILL\.md)`/g)) {
    const value = match[1]!
    if (value.includes(prefix)) paths.add(value.startsWith(".gatehouse/") ? value : path.posix.join(".gatehouse", value))
  }
  for (const match of markdown.matchAll(/\.gatehouse\/skills\/by-domain\/[^\s`]+\/SKILL\.md/g)) {
    paths.add(match[0]!)
  }
  return [...paths]
}

export async function countNewSkillsForMissionDomain(input: {
  projectDirectory: string
  missionId: string
  domain: string
  candidatePaths: string[]
}) {
  let count = 0
  for (const relPath of input.candidatePaths) {
    const abs = resolveProjectPath(input.projectDirectory, relPath)
    if (await Bun.file(abs).exists()) {
      const extractReport = resolveProjectPath(
        input.projectDirectory,
        `.gatehouse/trees/${input.missionId}/reports/skills`,
      )
      const glob = new Bun.Glob("*-extract.md")
      let existedBefore = false
      for await (const file of glob.scan({ cwd: extractReport, onlyFiles: true })) {
        const text = await Bun.file(path.join(extractReport, file)).text()
        if (text.includes(relPath) && !file.endsWith("-extract.md")) existedBefore = true
      }
      void existedBefore
    }
    const mtime = (await Bun.file(abs).exists()) ? (await Bun.file(abs).stat()).mtime : undefined
    if (mtime && Date.now() - mtime.getTime() < 1000 * 60 * 60) count += 1
  }
  return count
}

export async function runSkillQualityGate(input: {
  projectDirectory: string
  missionId: string
  nodeId: string
  domain: string
  summaryMarkdown: string
}): Promise<SkillGateResult> {
  const issues: SkillGateIssue[] = []
  const candidatePaths = parseSkillPathsFromExtractSummary(input.summaryMarkdown, input.domain)
  const existing = await listDomainSkillBodies(input.projectDirectory, input.domain)

  let newCount = 0
  for (const relPath of candidatePaths) {
    const abs = resolveProjectPath(input.projectDirectory, relPath)
    if (!(await Bun.file(abs).exists())) {
      issues.push({ code: "SKILL_FILE_MISSING", message: `SKILL.md not found: ${relPath}`, skill_path: relPath })
      continue
    }
    const body = await Bun.file(abs).text()
    const slug = relPath.split("/").slice(-2, -1)[0] ?? ""
    const score = abstractFrameworkScore(body)
    if (score.density > SKILL_PIPELINE.maxProductNameDensity || score.hits > SKILL_PIPELINE.maxProductNameHits) {
      issues.push({
        code: "PRODUCT_NAME_DENSITY",
        message: `Product name density too high (${(score.density * 100).toFixed(1)}%, hits=${score.hits}) — abstract to a generic framework: ${relPath}`,
        skill_path: relPath,
      })
    }
    if (score.tokenCount >= 80 && score.frameworkRatio < 0.02) {
      issues.push({
        code: "LOW_FRAMEWORK_SIGNAL",
        message: `Missing methodology structure signals — may be a one-off task report: ${relPath}`,
        skill_path: relPath,
      })
    }

    for (const other of existing) {
      if (other.relPath === relPath) continue
      const similarity = textSimilarity(body, other.body)
      if (similarity >= SKILL_PIPELINE.maxSimilarity) {
        issues.push({
          code: "DUPLICATE_SKILL",
          message: `Too similar to existing skill \`${other.slug}\` (${similarity.toFixed(2)} ≥ ${SKILL_PIPELINE.maxSimilarity}) — merge instead of creating new`,
          skill_path: relPath,
          similar_to: other.relPath,
          similarity,
        })
      }
    }

    const isNew = !existing.some((item) => item.relPath === relPath)
    if (isNew) newCount += 1
  }

  if (newCount > SKILL_PIPELINE.maxNewSkillsPerMissionDomain) {
    issues.push({
      code: "NEW_SKILL_LIMIT",
      message: `This mission exceeds the new skill limit in domain \`${input.domain}\` (${newCount} > ${SKILL_PIPELINE.maxNewSkillsPerMissionDomain})`,
    })
  }

  return { ok: issues.length === 0, issues, new_skill_paths: candidatePaths }
}

export async function runProgrammaticVerifier(input: {
  projectDirectory: string
  domain: string
  skillRelPaths: string[]
}) {
  const issues: SkillGateIssue[] = []
  for (const relPath of input.skillRelPaths) {
    const abs = resolveProjectPath(input.projectDirectory, relPath)
    if (!(await Bun.file(abs).exists())) {
      issues.push({ code: "VERIFY_MISSING", message: `Verification failed: file not found ${relPath}`, skill_path: relPath })
      continue
    }
    const body = await Bun.file(abs).text()
    const score = abstractFrameworkScore(body)
    if (score.density > SKILL_PIPELINE.maxProductNameDensity) {
      issues.push({
        code: "VERIFY_PRODUCT_DENSITY",
        message: `Verifier: product name density still too high ${relPath}`,
        skill_path: relPath,
      })
    }
    if (!/## 触发场景/.test(body) || !/## 禁止场景/.test(body)) {
      issues.push({
        code: "VERIFY_STRUCTURE",
        message: `Verifier: missing trigger/forbidden scenario sections ${relPath}`,
        skill_path: relPath,
      })
    }
  }
  return { ok: issues.length === 0, issues }
}
