import { existsSync } from "node:fs"
import path from "node:path"
import { ensurePortalAdminKey } from "@gatehouse/channels-core"
import { configYamlTemplate } from "./gatehouse-config.ts"
import { GATEHOUSE_LOCALES } from "./locale.ts"
import { readAgentNamesSync, renderGatehouseTemplate } from "./names.ts"
import { bundledGatehouseTemplateRoot } from "./paths.ts"
import { writeTemplateFile } from "./setup/template-copy.ts"
import { gatehouseTemplateDest, isLocaleSpecificGatehouseRelative } from "./template-paths.ts"

async function listLocaleTemplateRelatives(locale: (typeof GATEHOUSE_LOCALES)[number]) {
  const zhRoot = bundledGatehouseTemplateRoot("zh")
  const localeRoot = bundledGatehouseTemplateRoot(locale)
  const glob = new Bun.Glob("**/*")
  const relatives = new Set<string>()
  for await (const relative of glob.scan({ cwd: zhRoot, onlyFiles: true })) relatives.add(relative)
  if (locale !== "zh") {
    for await (const relative of glob.scan({ cwd: localeRoot, onlyFiles: true })) relatives.add(relative)
  }
  return [...relatives]
}

function bundledGatehouseTemplateSource(locale: (typeof GATEHOUSE_LOCALES)[number], relative: string) {
  const localized = path.join(bundledGatehouseTemplateRoot(locale), relative)
  if (existsSync(localized)) return localized
  return path.join(bundledGatehouseTemplateRoot("zh"), relative)
}

async function copyLocaleTemplateTree(
  locale: (typeof GATEHOUSE_LOCALES)[number],
  projectRoot: string,
  render?: (relativePath: string, text: string) => string,
) {
  for (const relative of await listLocaleTemplateRelatives(locale)) {
    if (relative === "config.yaml" || relative === "lead/missions.yaml") continue
    if (!isLocaleSpecificGatehouseRelative(relative) && relative !== "skills/domains.yaml") continue

    const source = bundledGatehouseTemplateSource(locale, relative)
    if (!(await Bun.file(source).exists())) continue

    const dest = gatehouseTemplateDest(projectRoot, locale, relative)
    if (await Bun.file(dest).exists()) continue
    await Bun.$`mkdir -p ${path.dirname(dest)}`.quiet()
    await writeTemplateFile(source, dest, relative, render)
  }
}

export async function scaffoldGatehouse(projectRoot: string) {
  const root = path.resolve(projectRoot)

  for (const dir of [
    ".gatehouse/lead/reports",
    ".gatehouse/trees",
    ".gatehouse/internal/exports",
    ".gatehouse/skills/retro-toolkit/tools",
    ".gatehouse/arbiter",
    ".gatehouse/skills/by-domain",
    ...GATEHOUSE_LOCALES.map((locale) => `.gatehouse/${locale}`),
  ]) {
    await Bun.$`mkdir -p ${path.join(root, dir)}`.quiet()
  }

  const configPath = path.join(root, ".gatehouse/config.yaml")
  if (!(await Bun.file(configPath).exists())) {
    const templateConfig = path.join(bundledGatehouseTemplateRoot("zh"), "config.yaml")
    const content = (await Bun.file(templateConfig).exists())
      ? await Bun.file(templateConfig).text()
      : configYamlTemplate()
    await Bun.write(configPath, content)
  }

  const renderNames = (relative: string, text: string) => {
    if (relative.includes("/prompts/")) return text
    return renderGatehouseTemplate(text, readAgentNamesSync(root))
  }

  for (const locale of GATEHOUSE_LOCALES) {
    await copyLocaleTemplateTree(locale, root, renderNames)
  }

  const brandSrc = path.join(bundledGatehouseTemplateRoot("zh"), "brand", "logo.png")
  const brandDest = path.join(root, ".gatehouse", "brand", "logo.png")
  if ((await Bun.file(brandSrc).exists()) && !(await Bun.file(brandDest).exists())) {
    await Bun.$`mkdir -p ${path.dirname(brandDest)}`.quiet()
    await Bun.write(brandDest, await Bun.file(brandSrc).arrayBuffer())
  }

  const indexPath = path.join(root, ".gatehouse/trees-index.yaml")
  if (!(await Bun.file(indexPath).exists())) {
    await Bun.write(indexPath, Bun.YAML.stringify({ trees: [] }))
  }

  const missionsPath = path.join(root, ".gatehouse/lead/missions.yaml")
  if (!(await Bun.file(missionsPath).exists())) {
    await Bun.write(
      missionsPath,
      Bun.YAML.stringify({
        schema_version: 1,
        missions: [],
      }),
    )
  }

  ensurePortalAdminKey(root)
}
