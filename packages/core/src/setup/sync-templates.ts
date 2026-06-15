import path from "node:path"
import { existsSync } from "node:fs"
import { loadGatehouseConfig } from "../gatehouse-config.ts"
import { GATEHOUSE_LOCALES } from "../locale.ts"
import { readAgentNamesSync, renderGatehouseTemplate } from "../names.ts"
import { bundledGatehouseTemplateRoot } from "../paths.ts"
import { syncGlobalOpencodeAgents } from "./global-opencode.ts"
import { writeTemplateFile } from "./template-copy.ts"
import { ensureMetaSkillCopies } from "../skills/meta-skill-copies.ts"
import { gatehouseTemplateDest, isLocaleSpecificGatehouseRelative } from "../template-paths.ts"

/** Project-owned under .gatehouse/ — sync must not clobber agent/user edits (same as scaffold). */
const outerMetaSkillRelatives = new Set([
  "skills/lead-meta/SKILL.md",
  "skills/architect-meta/SKILL.md",
  "skills/curator-meta/SKILL.md",
  "skills/arbiter-meta/SKILL.md",
])

const gatehousePrompts = /^prompts\//
const architectRetroToolkit = /^skills\/retro-toolkit\//
const gatehouseSkills = /^skills\//

function skipSyncGatehouseFile(relative: string) {
  if (relative === "config.yaml") return true
  if (relative.startsWith("brand/")) return true
  if (relative === "lead/missions.yaml") return true
  if (architectRetroToolkit.test(relative)) return true
  if (gatehouseSkills.test(relative)) return true
  if (gatehousePrompts.test(relative)) return true
  if (outerMetaSkillRelatives.has(relative)) return true
  return false
}

function renderManagedGatehouseFile(relative: string, raw: string, names: ReturnType<typeof readAgentNamesSync>) {
  if (!/\.(md|yaml|yml)$/.test(relative)) return raw
  if (relative.includes("/prompts/")) return raw
  return renderGatehouseTemplate(raw, names)
}

async function listLocaleTemplateRelatives(locale: (typeof GATEHOUSE_LOCALES)[number]) {
  const zhRoot = bundledGatehouseTemplateRoot("zh")
  const localeRoot = bundledGatehouseTemplateRoot(locale)
  const glob = new Bun.Glob("**/*")
  const relatives = new Set<string>()
  if (existsSync(zhRoot)) {
    for await (const relative of glob.scan({ cwd: zhRoot, onlyFiles: true })) relatives.add(relative)
  }
  if (locale !== "zh" && existsSync(localeRoot)) {
    for await (const relative of glob.scan({ cwd: localeRoot, onlyFiles: true })) relatives.add(relative)
  }
  return [...relatives]
}

function bundledGatehouseTemplateSource(locale: (typeof GATEHOUSE_LOCALES)[number], relative: string) {
  const localized = path.join(bundledGatehouseTemplateRoot(locale), relative)
  if (existsSync(localized)) return localized
  return path.join(bundledGatehouseTemplateRoot("zh"), relative)
}

async function syncLocaleGatehouseTemplates(
  projectRoot: string,
  locale: (typeof GATEHOUSE_LOCALES)[number],
  names: ReturnType<typeof readAgentNamesSync>,
) {
  if (!existsSync(bundledGatehouseTemplateRoot("zh"))) return

  for (const relative of await listLocaleTemplateRelatives(locale)) {
    if (!isLocaleSpecificGatehouseRelative(relative) && relative !== "skills/domains.yaml") continue

    const source = bundledGatehouseTemplateSource(locale, relative)
    if (!existsSync(source)) continue

    const dest = gatehouseTemplateDest(projectRoot, locale, relative)
    if (skipSyncGatehouseFile(relative)) {
      if (await Bun.file(dest).exists()) continue
    }
    await Bun.$`mkdir -p ${path.dirname(dest)}`.quiet()
    await writeTemplateFile(
      source,
      dest,
      relative,
      (fileRelative, raw) => renderManagedGatehouseFile(fileRelative, raw, names),
    )
  }
}

export async function syncManagedTemplates(projectRoot: string) {
  const root = path.resolve(projectRoot)
  const names = readAgentNamesSync(root)
  const locale = loadGatehouseConfig(root).locale

  for (const item of GATEHOUSE_LOCALES) {
    await syncLocaleGatehouseTemplates(root, item, names)
  }

  const brandSrc = path.join(bundledGatehouseTemplateRoot("zh"), "brand", "logo.png")
  const brandDest = path.join(root, ".gatehouse", "brand", "logo.png")
  if (existsSync(brandSrc) && !existsSync(brandDest)) {
    await Bun.$`mkdir -p ${path.dirname(brandDest)}`.quiet()
    await Bun.write(brandDest, await Bun.file(brandSrc).arrayBuffer())
  }

  await syncGlobalOpencodeAgents(locale, names)
  ensureMetaSkillCopies(root, locale)
}
