import { curatorSkillAssignKickoffPath } from "../paths.ts"
import { formatMissionContractBlock } from "../missions/contract-format.ts"
import { requireActiveMissionContract } from "../missions/contract.ts"
import { gatehouseMessage } from "../i18n.ts"
import { DEFAULT_GATEHOUSE_LOCALE, readLocaleSync, type GatehouseLocale } from "../locale.ts"
import { defaultAgentNames, readAgentNamesSync, renderGatehouseTemplate, type OuterProfile } from "../names.ts"
import { formatTeamSpecAssignmentSummary } from "../dispatch/team-snapshot.ts"
import { formatSkillDomainsRegistry, readSkillDomainsRegistry } from "../skills/domains.ts"
import type { TeamSpec } from "../tree/types.ts"

export async function loadCuratorSkillAssignKickoff(
  projectDirectory: string,
  input: { missionId: string; objective?: string; spec: TeamSpec },
) {
  const locale = readLocaleSync(projectDirectory)
  const contract = requireActiveMissionContract(projectDirectory, input.missionId)
  const domains = await readSkillDomainsRegistry(projectDirectory)
  const template = renderGatehouseTemplate(
    await Bun.file(curatorSkillAssignKickoffPath(projectDirectory)).text(),
    readAgentNamesSync(projectDirectory),
  )
  return template
    .replaceAll("{{mission_id}}", input.missionId)
    .replaceAll(
      "{{objective}}",
      input.objective ?? contract.objective ?? gatehouseMessage("mission.objectiveMissing", locale),
    )
    .replaceAll("{{mission_contract}}", formatMissionContractBlock(contract, locale))
    .replaceAll("{{teamspec_summary}}", formatTeamSpecAssignmentSummary(input.spec, locale))
    .replaceAll("{{domains_registry}}", formatSkillDomainsRegistry(domains, locale))
}

export function curatorSkillExtractBatchReadyMessage(
  missionId: string,
  completions: { nodeId: string; summaryPath?: string }[],
  names: Record<OuterProfile, string> = defaultAgentNames(),
  locale: GatehouseLocale = DEFAULT_GATEHOUSE_LOCALE,
) {
  const lines = completions
    .map((item) => `- ${item.nodeId}${item.summaryPath ? `: ${item.summaryPath}` : ""}`)
    .join("\n")
  return renderGatehouseTemplate(
    gatehouseMessage("curator.skillExtractBatchReady", locale, { mission_id: missionId, lines }),
    names,
  )
}
