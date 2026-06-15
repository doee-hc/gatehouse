import { gatehouseMessage } from "../i18n.ts"
import { bulletList } from "../missions/parse.ts"
import type { MissionContract } from "../missions/contract.ts"
import { DEFAULT_GATEHOUSE_LOCALE, type GatehouseLocale } from "../locale.ts"

/** Short mission context for all execution nodes (no topology notes). */
export function formatMissionContextBlock(
  contract: MissionContract,
  locale: GatehouseLocale = DEFAULT_GATEHOUSE_LOCALE,
) {
  const objective = contract.objective ?? gatehouseMessage("execution.missionContext.objectiveMissing", locale)
  const lines = [
    gatehouseMessage("execution.missionContext.header", locale),
    "",
    gatehouseMessage("execution.missionContext.objective", locale, { objective }),
    "",
    gatehouseMessage("mission.contract.mustNotHeader", locale),
    bulletList(contract.must_not, locale),
    "",
    gatehouseMessage("execution.missionContext.readonlyHint", locale),
    "",
    gatehouseMessage("execution.missionContext.actionHint", locale),
  ]
  return lines.join("\n")
}
