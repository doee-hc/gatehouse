import path from "node:path"
import { DEFAULT_GATEHOUSE_LOCALE, readLocaleSync, type GatehouseLocale } from "../locale.ts"
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

function extractDescriptionFromFrontmatter(text: string): string | undefined {
  if (!text.startsWith("---")) return undefined
  const end = text.indexOf("\n---", 3)
  if (end === -1) return undefined
  const yaml = text.slice(3, end).trim()

  const folded = yaml.match(/^description:\s*>-?\s*\r?\n([\s\S]*?)(?=^\S|\s*$)/m)
  if (folded?.[1]) {
    return folded[1]
      .split("\n")
      .map((line) => line.replace(/^\s{2}/, "").trimEnd())
      .join(" ")
      .trim()
  }

  const quoted = yaml.match(/^description:\s*["'](.+)["']\s*$/m)
  if (quoted) return quoted[1]

  const inline = yaml.match(/^description:\s*(.+)$/m)
  return inline?.[1]?.trim()
}

export async function resolveAgentTemplatePath(filename: string, projectDirectory: string) {
  const locale = readLocaleSync(projectDirectory)
  const projectOverride = path.join(gatehouseLocaleRoot(projectDirectory, locale), "opencode", "agent", filename)
  if (await Bun.file(projectOverride).exists()) return projectOverride
  return resolveBundledOpencodeAgentPath(locale, filename)
}

export async function loadAgentDescription(projectDirectory: string, filename: string) {
  const file = await resolveAgentTemplatePath(filename, projectDirectory)
  return readAgentDescriptionFromFile(file)
}

export async function loadBundledAgentDescription(
  filename: string,
  locale: GatehouseLocale = DEFAULT_GATEHOUSE_LOCALE,
) {
  const file = resolveBundledOpencodeAgentPath(locale, filename)
  return readAgentDescriptionFromFile(file)
}

async function readAgentDescriptionFromFile(file: string) {
  const raw = await Bun.file(file).text()
  return extractDescriptionFromFrontmatter(raw)
}
