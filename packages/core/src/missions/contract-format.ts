import { gatehouseMessage } from "../i18n.ts"
import type { GatehouseLocale } from "../locale.ts"
import { filterDoneWhenForExecutionTeam } from "./done-when-filter.ts"
import { bulletList } from "./parse.ts"
import type { MissionContract } from "./contract.ts"

export type MissionContractAudience = "architect" | "curator" | "execution" | "full"

function appendOptionalSection(lines: string[], header: string, body: string | undefined) {
  if (body?.trim()) {
    lines.push("", header, body.trim())
  }
}

function formatMissionContractCore(
  contract: MissionContract,
  locale: GatehouseLocale,
  audience: MissionContractAudience,
) {
  const doneWhen =
    audience === "full"
      ? contract.done_when
      : filterDoneWhenForExecutionTeam(contract.done_when)

  const lines = [
    gatehouseMessage("mission.contract.header", locale),
    "",
    gatehouseMessage("mission.contract.missionId", locale, { mission_id: contract.mission_id }),
    "",
    gatehouseMessage("mission.contract.objectiveHeader", locale),
    contract.objective ?? gatehouseMessage("mission.objectiveMissing", locale),
    "",
    gatehouseMessage("mission.contract.doneWhenHeader", locale),
    bulletList(doneWhen, locale),
    "",
    gatehouseMessage("mission.contract.mustNotHeader", locale),
    bulletList(contract.must_not, locale),
  ]

  const showTopology = audience === "architect" || audience === "full"
  const showNotes = audience === "architect" || audience === "full"
  const showSkill = audience === "curator" || audience === "full"

  if (showTopology) {
    appendOptionalSection(
      lines,
      gatehouseMessage("mission.contract.userTopologyHeader", locale),
      contract.user_topology,
    )
  }
  if (showNotes) {
    appendOptionalSection(lines, gatehouseMessage("mission.contract.notesHeader", locale), contract.notes)
  }
  if (showSkill) {
    appendOptionalSection(
      lines,
      gatehouseMessage("mission.contract.userSkillHeader", locale),
      contract.user_skill,
    )
  }

  return lines.join("\n")
}

export function formatMissionContractForRole(
  contract: MissionContract,
  locale: GatehouseLocale,
  audience: MissionContractAudience,
) {
  return formatMissionContractCore(contract, locale, audience)
}

/** Full mission snapshot (lead info tool, tests). */
export function formatMissionContractBlock(contract: MissionContract, locale: GatehouseLocale) {
  return formatMissionContractForRole(contract, locale, "full")
}
