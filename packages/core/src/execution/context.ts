import { bulletList } from "../missions/parse.ts"
import type { MissionContract } from "../missions/contract.ts"
import { DEFAULT_GATEHOUSE_LOCALE, type GatehouseLocale } from "../locale.ts"

/** Short mission context for all execution nodes (no topology notes). */
export function formatMissionContextBlock(contract: MissionContract, locale: GatehouseLocale = DEFAULT_GATEHOUSE_LOCALE) {
  const lines = [
    "## Mission Context（共同边界）",
    "",
    `**目标：** ${contract.objective ?? "（未提供）"}`,
    "",
    "**边界（must_not）：**",
    bulletList(contract.must_not, locale),
    "",
    "**边界只读：** `gatehouse_mission_context`",
    "",
    "行动依据：`gatehouse_node_brief`。验收以 Brief 的 acceptance_slice 为准，勿自行扩大范围。",
  ]
  return lines.join("\n")
}
