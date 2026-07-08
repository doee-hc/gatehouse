import { curatorSkillAssignKickoffPath } from "../paths.ts"
import { formatMissionContractForRole } from "../missions/contract-format.ts"
import { requireActiveMissionContract } from "../missions/contract.ts"
import { gatehouseMessage } from "../i18n.ts"
import { readLocaleSync } from "../locale.ts"
import { readAgentNamesSync, renderGatehouseTemplate } from "../names.ts"
import { formatMissionTeamSpecAssignmentSummary } from "../dispatch/team-snapshot.ts"
import { formatSkillDomainsRegistry, readSkillDomainsRegistry } from "../skills/domains.ts"
import type { MissionTeamSpec } from "../missions/manifest/types.ts"

export async function loadCuratorSkillAssignKickoff(
  projectDirectory: string,
  input: { missionId: string; objective?: string; spec: MissionTeamSpec; phase?: "retro" },
) {
  const locale = readLocaleSync(projectDirectory)
  const contract = requireActiveMissionContract(projectDirectory, input.missionId)
  const domains = await readSkillDomainsRegistry(projectDirectory)
  const agentNames = readAgentNamesSync(projectDirectory)
  const template = renderGatehouseTemplate(
    await Bun.file(curatorSkillAssignKickoffPath(projectDirectory)).text(),
    agentNames,
  )
  const assignmentIntro = renderGatehouseTemplate(
    gatehouseMessage(
      input.phase === "retro" ? "curator.skillAssign.introRetro" : "curator.skillAssign.introPreExecution",
      locale,
    ),
    agentNames,
  )
  return template
    .replaceAll("{{mission_id}}", input.missionId)
    .replaceAll(
      "{{objective}}",
      input.objective ?? contract.objective ?? gatehouseMessage("mission.objectiveMissing", locale),
    )
    .replaceAll("{{assignment_intro}}", assignmentIntro)
    .replaceAll("{{mission_contract}}", formatMissionContractForRole(contract, locale, "curator"))
    .replaceAll("{{team_structure_summary}}", formatMissionTeamSpecAssignmentSummary(input.spec, locale))
    .replaceAll("{{domains_registry}}", formatSkillDomainsRegistry(domains, locale))
}
