import { renderGatehouseTemplate, readAgentNamesSync } from "../names.ts"
import { DEFAULT_GATEHOUSE_LOCALE, readLocaleSync } from "../locale.ts"
import {
  domainSkillVerifyPromptPath,
  nodeContextRelDir,
  skillDomainDir,
} from "../paths.ts"

export async function loadDomainSkillVerifyPrompt(
  projectDirectory: string,
  input: { missionId: string; nodeId: string; skillDomain: string },
) {
  const locale = readLocaleSync(projectDirectory)
  const template = renderGatehouseTemplate(
    await Bun.file(domainSkillVerifyPromptPath(projectDirectory)).text(),
    readAgentNamesSync(projectDirectory),
  )
  const domainPath = skillDomainDir(input.skillDomain)
  return template
    .replaceAll("{{mission_id}}", input.missionId)
    .replaceAll("{{node_id}}", input.nodeId)
    .replaceAll("{{skill_domain}}", input.skillDomain)
    .replaceAll("{{skill_domain_path}}", domainPath)
    .replaceAll("{{context_node_path}}", nodeContextRelDir(input.missionId, input.nodeId))
    .replaceAll("{{locale}}", locale === "zh" ? "zh" : "en")
}
