import { retroAnalysisPromptPath } from "../paths.ts"
import { gatehouseMessage } from "../i18n.ts"
import { DEFAULT_GATEHOUSE_LOCALE, readLocaleSync, type GatehouseLocale } from "../locale.ts"
import { defaultAgentNames, readAgentNamesSync, renderGatehouseTemplate, type OuterProfile } from "../names.ts"

export async function loadRetroKickoffPrompt(
  projectDirectory: string,
  input: { missionId: string; nodeId: string },
) {
  const template = renderGatehouseTemplate(
    await Bun.file(retroAnalysisPromptPath(projectDirectory)).text(),
    readAgentNamesSync(projectDirectory),
  )
  return template
    .replaceAll("{{mission_id}}", input.missionId)
    .replaceAll("{{node_id}}", input.nodeId)
}

export function architectRetroBatchReadyMessage(
  missionId: string,
  completions: { nodeId: string; reportPath: string }[],
  names: Record<OuterProfile, string> = defaultAgentNames(),
  locale: GatehouseLocale = DEFAULT_GATEHOUSE_LOCALE,
) {
  const lines = completions.map((item) => `- ${item.nodeId}: ${item.reportPath}`).join("\n")
  return renderGatehouseTemplate(
    gatehouseMessage("retro.batchReady", locale, { mission_id: missionId, lines }),
    names,
  )
}
