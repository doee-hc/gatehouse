import path from "node:path"
import { readLocaleSync } from "../locale.ts"
import { gatehouseLocaleRoot } from "../paths.ts"
import { resolveBundledOpencodeAgentPath } from "../template-paths.ts"

export function stripMarkdownFrontmatter(text: string) {
  if (!text.startsWith("---")) return text.trim()
  const end = text.indexOf("\n---", 3)
  if (end === -1) return text.trim()
  return text.slice(end + 4).trim()
}

export function parseMarkdownFrontmatter(text: string): Record<string, unknown> {
  if (!text.startsWith("---")) return {}
  const end = text.indexOf("\n---", 3)
  if (end === -1) return {}
  const yaml = text.slice(3, end).trim()
  const parsed = Bun.YAML.parse(yaml)
  if (typeof parsed !== "object" || parsed === null) return {}
  return parsed as Record<string, unknown>
}

export async function resolveAgentTemplatePath(filename: string, projectDirectory: string) {
  const locale = readLocaleSync(projectDirectory)
  const projectOverride = path.join(gatehouseLocaleRoot(projectDirectory, locale), "opencode", "agent", filename)
  if (await Bun.file(projectOverride).exists()) return projectOverride
  return resolveBundledOpencodeAgentPath(locale, filename)
}

export async function loadAgentDescription(projectDirectory: string, filename: string) {
  const file = await resolveAgentTemplatePath(filename, projectDirectory)
  const raw = await Bun.file(file).text()
  const frontmatter = parseMarkdownFrontmatter(raw)
  return typeof frontmatter.description === "string" ? frontmatter.description : undefined
}
