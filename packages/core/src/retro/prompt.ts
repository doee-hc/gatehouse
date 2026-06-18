import {
  retroKickoffPromptPath,
  retroSummaryRelPath,
  retroSummaryTemplatePath,
} from "../paths.ts"
import { gatehouseMessage } from "../i18n.ts"
import { DEFAULT_GATEHOUSE_LOCALE, readLocaleSync, type GatehouseLocale } from "../locale.ts"
import { defaultAgentNames, readAgentNamesSync, renderGatehouseTemplate, type OuterProfile } from "../names.ts"
import { retroAnalysisSteps, type RetroAnalysisStep } from "./analysis-order.ts"
import type { OrchestrationPlan } from "../orchestration/plan-types.ts"
import type { TreeManifest } from "../tree/types.ts"

function formatAnalysisSteps(steps: RetroAnalysisStep[], locale: GatehouseLocale) {
  if (steps.length === 0) {
    return gatehouseMessage("retro.kickoff.noPlanSteps", locale)
  }
  return steps
    .map((step, index) => {
      const nodes = step.node_ids.join(", ")
      if (step.op === "fork") {
        return gatehouseMessage("retro.kickoff.forkStep", locale, {
          index: String(index + 1),
          nodes,
        })
      }
      return gatehouseMessage("retro.kickoff.runStep", locale, {
        index: String(index + 1),
        node: nodes,
      })
    })
    .join("\n")
}

export async function loadRetroKickoffPrompt(
  projectDirectory: string,
  input: { missionId: string; manifest: TreeManifest; plan?: OrchestrationPlan },
) {
  const locale = readLocaleSync(projectDirectory)
  const names = readAgentNamesSync(projectDirectory)
  const template = renderGatehouseTemplate(
    await Bun.file(retroKickoffPromptPath(projectDirectory)).text(),
    names,
  )
  const steps = input.plan ? retroAnalysisSteps(input.plan) : []
  const retroContext = [
    gatehouseMessage("retro.kickoff.contextHeader", locale),
    gatehouseMessage("retro.kickoff.mission", locale, { mission_id: input.missionId }),
    gatehouseMessage("retro.kickoff.rootNode", locale, { terminal_node: input.manifest.root_node }),
    gatehouseMessage("retro.kickoff.nodeCount", locale, {
      node_count: String(Object.keys(input.manifest.nodes).length),
    }),
    "",
    gatehouseMessage("retro.kickoff.analysisOrderHeader", locale),
    formatAnalysisSteps(steps, locale),
    "",
    gatehouseMessage("retro.kickoff.contextPaths", locale, { mission_id: input.missionId }),
  ].join("\n")
  return template
    .replaceAll("{{mission_id}}", input.missionId)
    .replaceAll("{{retro_context_snapshot}}", retroContext)
    .replaceAll("{{retro_summary_path}}", retroSummaryRelPath(input.missionId))
    .replaceAll("{{retro_summary_template_path}}", retroSummaryTemplatePath(projectDirectory))
}

export function architectRetroReviewReadyMessage(
  missionId: string,
  retroSummaryPath: string,
  names: Record<OuterProfile, string> = defaultAgentNames(),
  locale: GatehouseLocale = DEFAULT_GATEHOUSE_LOCALE,
) {
  return renderGatehouseTemplate(
    gatehouseMessage("retro.reviewReady", locale, {
      mission_id: missionId,
      retro_summary_path: retroSummaryPath,
      architect_name: names.architect,
    }),
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
