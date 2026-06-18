import { existsSync } from "node:fs"
import path from "node:path"
import { DEFAULT_GATEHOUSE_LOCALE, type GatehouseLocale } from "./locale.ts"
import { bundledGatehouseTemplateRoot, gatehouseLocaleRoot, gatehouseRoot } from "./paths.ts"

const bundledTemplateRoot = path.join(import.meta.dir, "..", "templates")

export const LOCALE_SPECIFIC_GATEHOUSE_PREFIXES = [
  "skills/lead-meta/",
  "skills/architect-meta/",
  "skills/curator-meta/",
  "skills/arbiter-meta/",
  "skills/retro-analyst-meta/",
  "skills/retro-toolkit/",
  "prompts/",
  "skills/by-domain/",
] as const

export function isLocaleSpecificGatehouseRelative(relative: string) {
  return LOCALE_SPECIFIC_GATEHOUSE_PREFIXES.some(
    (prefix) => relative === prefix.slice(0, -1) || relative.startsWith(prefix),
  )
}

export function bundledOpencodeTemplateRoot(locale: GatehouseLocale = DEFAULT_GATEHOUSE_LOCALE) {
  return path.join(bundledTemplateRoot, locale, "opencode")
}

export function gatehouseTemplateDest(
  projectDirectory: string,
  locale: GatehouseLocale,
  relative: string,
) {
  if (isLocaleSpecificGatehouseRelative(relative)) {
    return path.join(gatehouseLocaleRoot(projectDirectory, locale), relative)
  }
  return path.join(gatehouseRoot(projectDirectory), relative)
}

export { bundledGatehouseTemplateRoot }

export function resolveBundledOpencodeAgentPath(locale: GatehouseLocale, filename: string): string {
  const candidates = [
    path.join(bundledOpencodeTemplateRoot(locale), "agent", filename),
    ...(locale !== "zh" ? [path.join(bundledOpencodeTemplateRoot("zh"), "agent", filename)] : []),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return candidates[0]!
}
