import { curatorSkillAssignKickoffPath } from "../paths.ts"
import { gatehouseMessage } from "../i18n.ts"
import { DEFAULT_GATEHOUSE_LOCALE, readLocaleSync, type GatehouseLocale } from "../locale.ts"
import { defaultAgentNames, readAgentNamesSync, renderGatehouseTemplate, type OuterProfile } from "../names.ts"

export async function loadCuratorSkillAssignKickoff(
  projectDirectory: string,
  input: { missionId: string; objective?: string },
) {
  const template = renderGatehouseTemplate(
    await Bun.file(curatorSkillAssignKickoffPath(projectDirectory)).text(),
    readAgentNamesSync(projectDirectory),
  )
  return template
    .replaceAll("{{mission_id}}", input.missionId)
    .replaceAll(
      "{{objective}}",
      input.objective ?? gatehouseMessage("curator.objectiveFallback", readLocaleSync(projectDirectory)),
    )
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
