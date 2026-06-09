import { gatehouseMessage } from "../i18n.ts"
import type { GatehouseLocale } from "../locale.ts"
import { bulletList } from "./parse.ts"
import type { MissionContract } from "./contract.ts"

export type MissionContractAudience = "architect" | "curator" | "execution" | "full"

const SKILL_NOTE_PREFIXES = ["[用户指定·skill]", "[user-specified·skill]"] as const
const TOPOLOGY_NOTE_PREFIXES = ["[用户指定·拓扑]", "[user-specified·topology]"] as const

function lineStartsWithPrefix(line: string, prefixes: readonly string[]) {
  const trimmed = line.trimStart()
  return prefixes.some((prefix) => trimmed.startsWith(prefix))
}

export function filterMissionNotesForAudience(
  notes: string | undefined,
  audience: MissionContractAudience,
): string | undefined {
  if (!notes?.trim() || audience === "execution") return undefined
  const lines = notes.split("\n")
  if (audience === "curator") {
    const filtered = lines.filter((line) => lineStartsWithPrefix(line, SKILL_NOTE_PREFIXES))
    const text = filtered.join("\n").trim()
    return text || undefined
  }
  if (audience === "architect") {
    const filtered = lines.filter((line) => !lineStartsWithPrefix(line, SKILL_NOTE_PREFIXES))
    const text = filtered.join("\n").trim()
    return text || undefined
  }
  return notes.trim()
}

function formatMissionContractCore(
  contract: MissionContract,
  locale: GatehouseLocale,
  audience: MissionContractAudience,
) {
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
  const notes = filterMissionNotesForAudience(contract.notes, audience)
  if (notes) {
    lines.push("", gatehouseMessage("mission.contract.notesHeader", locale), notes)
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

/** Full mission snapshot (lead tools, mission_current, tests). */
export function formatMissionContractBlock(contract: MissionContract, locale: GatehouseLocale) {
  return formatMissionContractForRole(contract, locale, "full")
}

export { SKILL_NOTE_PREFIXES, TOPOLOGY_NOTE_PREFIXES }
