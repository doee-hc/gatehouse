import { formatMissionContextBlock } from "../execution/context.ts"
import { formatNodeBriefBlock } from "../execution/brief.ts"
import type { NodeBrief } from "../execution/types.ts"
import type { GatehouseLocale } from "../locale.ts"
import { readLocaleSync } from "../locale.ts"
import {
  readMissionContractRawRegistry,
  readMissionRawDoneWhen,
  readNodeBriefRegistry,
} from "../execution/artifacts.ts"
import { RegistryDatabase } from "../registry/db.ts"
import type { RegistryAgent } from "../registry/types.ts"
import {
  INNER_COORDINATOR_AGENT,
  INNER_EXECUTION_AGENT,
  INNER_ROOT_AGENT,
  INNER_ROOT_SOLO_AGENT,
} from "../registry/types.ts"
import type { MissionContract } from "./contract.ts"
import { registryMissionToContract } from "./contract.ts"
import { formatMissionContractForRole } from "./contract-format.ts"
import type { MissionContractAudience } from "./contract-format.ts"
import { filterDoneWhenForExecutionTeam } from "./done-when-filter.ts"

export type MissionInfoRoleView = "lead" | "architect" | "curator" | "coordinator" | "execution"

export type MissionInfoPayload = {
  mission_id: string
  role_view: MissionInfoRoleView
  boundaries?: {
    objective?: string
    must_not: string[]
    markdown: string
  }
  contract?: MissionContract
  contract_markdown?: string
  brief?: {
    node_id: string
    status: "ok" | "not_found"
    brief?: NodeBrief
    markdown?: string
    note?: string
  }
  contract_raw?: unknown
  done_when_raw?: unknown
  markdown: string
}

function isInnerCoordinator(profile?: string) {
  return (
    profile === INNER_ROOT_AGENT ||
    profile === INNER_ROOT_SOLO_AGENT ||
    profile === INNER_COORDINATOR_AGENT
  )
}

export function resolveMissionInfoRoleView(sender: RegistryAgent | undefined): MissionInfoRoleView | "forbidden" {
  if (!sender) return "forbidden"
  if (sender.scope === "outer") {
    if (sender.profile === "lead") return "lead"
    if (sender.profile === "architect") return "architect"
    if (sender.profile === "curator") return "curator"
    return "forbidden"
  }
  if (sender.profile === INNER_EXECUTION_AGENT) return "execution"
  if (isInnerCoordinator(sender.profile)) return "coordinator"
  return "forbidden"
}

function contractAudience(roleView: MissionInfoRoleView): MissionContractAudience {
  if (roleView === "lead") return "full"
  if (roleView === "curator") return "curator"
  return "architect"
}

function visibleContract(contract: MissionContract, roleView: MissionInfoRoleView): MissionContract {
  if (roleView === "lead") return contract
  return { ...contract, done_when: filterDoneWhenForExecutionTeam(contract.done_when) }
}

function includesBoundaries(roleView: MissionInfoRoleView) {
  return roleView === "execution" || roleView === "coordinator"
}

function includesContract(roleView: MissionInfoRoleView) {
  return roleView === "lead" || roleView === "architect" || roleView === "curator" || roleView === "coordinator"
}

function includesBrief(roleView: MissionInfoRoleView) {
  return roleView === "execution" || roleView === "coordinator"
}

export async function resolveMissionInfo(input: {
  projectDirectory: string
  sender: RegistryAgent | undefined
  missionId: string
  locale?: GatehouseLocale
}): Promise<MissionInfoPayload | { error: "NOT_AUTHORIZED" | "NO_CONTRACT" }> {
  const roleView = resolveMissionInfoRoleView(input.sender)
  if (roleView === "forbidden") return { error: "NOT_AUTHORIZED" }

  const record = new RegistryDatabase(input.projectDirectory, { readonly: true }).getMission(input.missionId)
  if (!record) return { error: "NO_CONTRACT" }

  const locale = input.locale ?? readLocaleSync(input.projectDirectory)
  const contract = registryMissionToContract(record)
  const payload: MissionInfoPayload = {
    mission_id: input.missionId,
    role_view: roleView,
    markdown: "",
  }
  const markdownParts: string[] = []

  if (includesBoundaries(roleView)) {
    const boundariesMarkdown = formatMissionContextBlock(contract, locale)
    payload.boundaries = {
      objective: contract.objective,
      must_not: [...contract.must_not],
      markdown: boundariesMarkdown,
    }
    markdownParts.push(boundariesMarkdown)
  }

  if (includesContract(roleView)) {
    const shown = visibleContract(contract, roleView)
    payload.contract = shown
    const contractMarkdown = formatMissionContractForRole(shown, locale, contractAudience(roleView))
    payload.contract_markdown = contractMarkdown
    markdownParts.push(contractMarkdown)

    if (roleView === "lead") {
      const [rawDoneWhen, rawEntry] = await Promise.all([
        readMissionRawDoneWhen(input.projectDirectory, input.missionId),
        readMissionContractRawRegistry(input.projectDirectory, input.missionId),
      ])
      if (rawDoneWhen) payload.done_when_raw = rawDoneWhen
      if (rawEntry) payload.contract_raw = rawEntry
    }
  }

  if (includesBrief(roleView)) {
    const nodeId = input.sender?.nodeId
    if (nodeId) {
      const brief = await readNodeBriefRegistry(input.projectDirectory, input.missionId, nodeId)
      if (!brief) {
        payload.brief = {
          node_id: nodeId,
          status: "not_found",
          note:
            "No node brief in registry for this node. The orchestrator must call ctx.setBrief(...) before prompt(reply:true) for this node.",
        }
      } else {
        const briefMarkdown = formatNodeBriefBlock(brief)
        payload.brief = {
          node_id: nodeId,
          status: "ok",
          brief,
          markdown: briefMarkdown,
        }
        markdownParts.push(briefMarkdown)
      }
    }
  }

  payload.markdown = markdownParts.join("\n\n")
  return payload
}
