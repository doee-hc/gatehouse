import { gatehouseMessage } from "../i18n.ts"
import type { GatehouseLocale } from "../locale.ts"
import { bulletList } from "./parse.ts"
import type { MissionContract } from "./contract.ts"

export function formatMissionContractBlock(contract: MissionContract, locale: GatehouseLocale) {
  const lines = [
    gatehouseMessage("mission.contract.header", locale),
    "",
    gatehouseMessage("mission.contract.missionId", locale, { mission_id: contract.mission_id }),
    "",
    gatehouseMessage("mission.contract.objectiveHeader", locale),
    contract.objective ?? gatehouseMessage("mission.objectiveMissing", locale),
    "",
    gatehouseMessage("mission.contract.doneWhenHeader", locale),
    bulletList(contract.done_when, locale),
    "",
    gatehouseMessage("mission.contract.mustNotHeader", locale),
    bulletList(contract.must_not, locale),
  ]
  if (contract.notes?.trim()) {
    lines.push("", gatehouseMessage("mission.contract.notesHeader", locale), contract.notes.trim())
  }
  return lines.join("\n")
}
