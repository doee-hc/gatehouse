import { stat } from "node:fs/promises"
import { gatehouseMessage } from "../i18n.ts"
import { DEFAULT_GATEHOUSE_LOCALE, readLocaleSync, type GatehouseLocale } from "../locale.ts"
import { defaultAgentNames, readAgentNamesSync, renderGatehouseTemplate, type OuterProfile } from "../names.ts"
import { domainSkillExtractPromptPath, resolveProjectPath, skillDomainDir } from "../paths.ts"
import type { TeamSpec, TreeManifest } from "../tree/types.ts"

export function resolveExecSkillDomain(
  manifest: TreeManifest,
  nodeId: string,
  input: { spec?: TeamSpec; briefDomainIds?: string[] },
) {
  const manifestNode = manifest.nodes[nodeId]
  if (!manifestNode) return undefined
  if (manifestNode.skill_domain) return manifestNode.skill_domain
  return undefined
}

export function execSkillKickoffTargets(
  manifest: TreeManifest,
  input: { spec?: TeamSpec; briefDomainIds?: string[] },
) {
  return Object.keys(manifest.nodes).flatMap((nodeId) => {
    const skillDomain = resolveExecSkillDomain(manifest, nodeId, input)
    if (!skillDomain) return []
    const manifestNode = manifest.nodes[nodeId]
    if (!manifestNode) return []
    return [{ nodeId, skillDomain }]
  })
}

export async function listSkillSlugsInDomain(projectDirectory: string, skillDomain: string) {
  const domainAbs = resolveProjectPath(projectDirectory, skillDomainDir(skillDomain))
  const domainStat = await stat(domainAbs).catch(() => undefined)
  if (!domainStat?.isDirectory()) return []
  const glob = new Bun.Glob("*/SKILL.md")
  const slugs: string[] = []
  for await (const relative of glob.scan({ cwd: domainAbs, onlyFiles: true })) {
    const slash = relative.indexOf("/")
    if (slash <= 0) continue
    slugs.push(relative.slice(0, slash))
  }
  return slugs.sort()
}

export function formatSkillDomainExistingSection(
  skillDomainPath: string,
  slugs: string[],
  locale: GatehouseLocale = DEFAULT_GATEHOUSE_LOCALE,
) {
  if (slugs.length === 0) {
    return gatehouseMessage("skillDomain.existing.empty", locale)
  }
  const lines = slugs.map((slug) => `- \`${slug}\``).join("\n")
  return [
    gatehouseMessage("skillDomain.existing.header", locale),
    "",
    gatehouseMessage("skillDomain.existing.intro", locale, { path: skillDomainPath }),
    "",
    lines,
  ].join("\n")
}

export async function loadDomainSkillExtractPrompt(
  projectDirectory: string,
  input: { missionId: string; nodeId: string; skillDomain: string },
) {
  const locale = readLocaleSync(projectDirectory)
  const template = renderGatehouseTemplate(
    await Bun.file(domainSkillExtractPromptPath(projectDirectory)).text(),
    readAgentNamesSync(projectDirectory),
  )
  const domainPath = skillDomainDir(input.skillDomain)
  const existingSlugs = await listSkillSlugsInDomain(projectDirectory, input.skillDomain)
  return template
    .replaceAll("{{mission_id}}", input.missionId)
    .replaceAll("{{node_id}}", input.nodeId)
    .replaceAll("{{skill_domain}}", input.skillDomain)
    .replaceAll("{{skill_domain_path}}", domainPath)
    .replaceAll(
      "{{skill_domain_existing_section}}",
      formatSkillDomainExistingSection(domainPath, existingSlugs, locale),
    )
}

export function skillDomainContextNote(
  skillDomain: string,
  names: Record<OuterProfile, string> = defaultAgentNames(),
  locale: GatehouseLocale = DEFAULT_GATEHOUSE_LOCALE,
  skillSlugs: string[] = [],
) {
  const skill_catalog =
    skillSlugs.length > 0 ? skillSlugs.join(", ") : locale === "zh" ? "（暂无）" : "(none yet)"
  return renderGatehouseTemplate(
    gatehouseMessage("skillDomain.contextNote", locale, {
      skill_domain: skillDomain,
      skill_domain_path: skillDomainDir(skillDomain),
      skill_catalog,
    }),
    names,
  )
}
