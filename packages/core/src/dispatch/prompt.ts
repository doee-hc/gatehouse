import { bulletList } from "../missions/parse.ts"
import { requireActiveMissionContract } from "../missions/contract.ts"
import { dispatchRootPromptPath } from "../paths.ts"
import { gatehouseMessage } from "../i18n.ts"
import { readLocaleSync } from "../locale.ts"
import { readAgentNamesSync, renderGatehouseTemplate } from "../names.ts"

export async function loadDispatchRootPrompt(
  projectDirectory: string,
  missionId: string,
  objectiveOverride?: string,
) {
  const contract = requireActiveMissionContract(projectDirectory, missionId)
  const template = renderGatehouseTemplate(
    await Bun.file(dispatchRootPromptPath(projectDirectory)).text(),
    readAgentNamesSync(projectDirectory),
  )
  const locale = readLocaleSync(projectDirectory)
  const objective =
    objectiveOverride ??
    contract.objective ??
    gatehouseMessage("mission.objectiveMissing", locale)
  return template
    .replaceAll("{{mission_id}}", missionId)
    .replaceAll("{{objective}}", objective)
    .replaceAll("{{done_when_list}}", bulletList(contract.done_when, locale))
    .replaceAll("{{must_not_list}}", bulletList(contract.must_not, locale))
}
