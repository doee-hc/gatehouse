import { formatMissionContractBlock } from "../missions/contract-format.ts"
import { readActiveMissionContract } from "../missions/contract.ts"
import { bulletList } from "../missions/parse.ts"
import { gatehouseMessage } from "../i18n.ts"
import { readLocaleSync } from "../locale.ts"
import { LEAD_OPENCODE } from "../registry/types.ts"
import type { RegistryAgent } from "../registry/types.ts"
import { isInnerStructuralRoot } from "../registry/types.ts"

export function enrichLeadDeliveryMessage(
  projectDirectory: string,
  input: { sender: RegistryAgent; recipient: RegistryAgent; message: string },
) {
  if (input.recipient.profile !== LEAD_OPENCODE || input.recipient.scope !== "outer") return input.message
  if (!isInnerStructuralRoot(input.sender)) return input.message
  const missionId = input.sender.missionId
  if (!missionId) return input.message

  const locale = readLocaleSync(projectDirectory)
  const contract = readActiveMissionContract(projectDirectory, missionId)
  if (!contract) return input.message

  const checklist = bulletList(contract.done_when, locale)
  const footer = [
    "---",
    gatehouseMessage("delivery.lead.doneWhenHeader", locale),
    checklist,
    "",
    gatehouseMessage("delivery.lead.refreshHint", locale),
  ].join("\n")
  return `${input.message.trim()}\n\n${footer}`
}

export function formatMissionStartedMessage(
  projectDirectory: string,
  input: { missionId: string; leadName: string },
) {
  const locale = readLocaleSync(projectDirectory)
  const contract = readActiveMissionContract(projectDirectory, input.missionId)
  if (!contract) {
    return gatehouseMessage("mission.started.fallback", locale, {
      mission_id: input.missionId,
      lead_name: input.leadName,
    })
  }
  return gatehouseMessage("mission.started.body", locale, {
    mission_id: input.missionId,
    lead_name: input.leadName,
    mission_contract: formatMissionContractBlock(contract, locale),
  })
}
