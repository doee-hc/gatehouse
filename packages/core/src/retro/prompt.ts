import { retroAnalysisPromptPath } from "../paths.ts"
import { gatehouseMessage } from "../i18n.ts"
import { DEFAULT_GATEHOUSE_LOCALE, readLocaleSync, type GatehouseLocale } from "../locale.ts"
import { defaultAgentNames, readAgentNamesSync, renderGatehouseTemplate, type OuterProfile } from "../names.ts"
import { formatRetroKickoffContext, readRetroSubtreeMetrics } from "./subtree-context.ts"
import { managerRetroOrder } from "../tree/parse.ts"
import type { TreeManifest } from "../tree/types.ts"

export async function loadRetroKickoffPrompt(
  projectDirectory: string,
  input: { missionId: string; nodeId: string; manifest?: TreeManifest },
) {
  const locale = readLocaleSync(projectDirectory)
  const template = renderGatehouseTemplate(
    await Bun.file(retroAnalysisPromptPath(projectDirectory)).text(),
    readAgentNamesSync(projectDirectory),
  )
  const retroOrder = input.manifest ? managerRetroOrder(input.manifest) : []
  const subtree = await readRetroSubtreeMetrics(projectDirectory, input.missionId, input.nodeId)
  const retroContext = formatRetroKickoffContext({
    missionId: input.missionId,
    nodeId: input.nodeId,
    retroOrder,
    subtree,
    locale,
  })
  return template
    .replaceAll("{{mission_id}}", input.missionId)
    .replaceAll("{{node_id}}", input.nodeId)
    .replaceAll("{{retro_context_snapshot}}", retroContext)
}

export function architectRetroBatchReadyMessage(
  missionId: string,
  completions: { nodeId: string; reportPath: string }[],
  names: Record<OuterProfile, string> = defaultAgentNames(),
  locale: GatehouseLocale = DEFAULT_GATEHOUSE_LOCALE,
) {
  const lines = completions.map((item) => `- ${item.nodeId}: ${item.reportPath}`).join("\n")
  return renderGatehouseTemplate(
    gatehouseMessage("retro.batchReady", locale, { mission_id: missionId, lines, lead_name: names.lead }),
    names,
  )
}

export function leadRetroRollupReadyMessage(
  missionId: string,
  input: {
    architectSummaryPath: string
    curatorSummaryPath?: string
    locale?: GatehouseLocale
    leadName?: string
  },
  names: Record<OuterProfile, string> = defaultAgentNames(),
) {
  const locale = input.locale ?? DEFAULT_GATEHOUSE_LOCALE
  const curatorLine = input.curatorSummaryPath
    ? gatehouseMessage("retro.rollupReady.curatorLine", locale, { curator_summary_path: input.curatorSummaryPath })
    : ""
  const curatorSuffix = input.curatorSummaryPath
    ? gatehouseMessage("retro.rollupReady.curatorSuffix", locale)
    : ""
  return renderGatehouseTemplate(
    gatehouseMessage("retro.rollupReady", locale, {
      mission_id: missionId,
      architect_summary_path: input.architectSummaryPath,
      curator_line: curatorLine,
      curator_suffix: curatorSuffix,
      lead_name: input.leadName ?? names.lead,
    }),
    names,
  )
}
