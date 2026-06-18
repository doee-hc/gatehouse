import { formatMissionContextBlock } from "../execution/context.ts"
import { formatNodeBriefBlock } from "../execution/brief.ts"
import type { GatehouseLocale } from "../locale.ts"
import { readLocaleSync } from "../locale.ts"
import { readNodeBriefRegistry } from "../execution/artifacts.ts"
import { RegistryDatabase } from "../registry/db.ts"
import type { RegistryAgent } from "../registry/types.ts"
import { INNER_EXECUTION_AGENT } from "../registry/types.ts"
import type { MissionContract } from "./contract.ts"
import { registryMissionToContract } from "./contract.ts"
import { formatMissionContractForRole } from "./contract-format.ts"
import type { MissionContractAudience } from "./contract-format.ts"
import { filterDoneWhenForExecutionTeam } from "./done-when-filter.ts"
import {
  innerNodeShowsMissionContract,
  innerNodeShowsMissionContractFromManifest,
} from "../tree/parse.ts"
import { readManifest } from "../tree/store.ts"

export type MissionInfoRoleView = "lead" | "architect" | "curator" | "acceptance" | "execution"

export type MissionInfoPayload = {
  mission_id: string
  role_view: MissionInfoRoleView
  markdown: string
}

async function resolveInnerMissionInfoRoleView(
  projectDirectory: string,
  sender: RegistryAgent,
): Promise<MissionInfoRoleView | "forbidden"> {
  if (sender.scope !== "inner" || sender.profile !== INNER_EXECUTION_AGENT) return "forbidden"
  if (!sender.missionId || !sender.nodeId) return "execution"

  const script = new RegistryDatabase(projectDirectory, { readonly: true }).getMissionScript(sender.missionId)
  if (script?.team) {
    return innerNodeShowsMissionContract(script.team, sender.nodeId) ? "acceptance" : "execution"
  }

  const manifest = await readManifest(projectDirectory, sender.missionId)
  if (manifest) {
    return innerNodeShowsMissionContractFromManifest(manifest, sender.nodeId) ? "acceptance" : "execution"
  }

  return "execution"
}

export async function resolveMissionInfoRoleView(
  projectDirectory: string,
  sender: RegistryAgent | undefined,
): Promise<MissionInfoRoleView | "forbidden"> {
  if (!sender) return "forbidden"
  if (sender.scope === "outer") {
    if (sender.profile === "lead") return "lead"
    if (sender.profile === "architect") return "architect"
    if (sender.profile === "curator") return "curator"
    return "forbidden"
  }
  if (sender.scope === "inner") {
    return resolveInnerMissionInfoRoleView(projectDirectory, sender)
  }
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
  return roleView === "execution" || roleView === "acceptance"
}

function includesContract(roleView: MissionInfoRoleView) {
  return roleView === "lead" || roleView === "architect" || roleView === "curator" || roleView === "acceptance"
}

function includesBrief(roleView: MissionInfoRoleView) {
  return roleView === "execution" || roleView === "acceptance"
}

export async function resolveMissionInfo(input: {
  projectDirectory: string
  sender: RegistryAgent | undefined
  missionId: string
  locale?: GatehouseLocale
}): Promise<MissionInfoPayload | { error: "NOT_AUTHORIZED" | "NO_CONTRACT" }> {
  const roleView = await resolveMissionInfoRoleView(input.projectDirectory, input.sender)
  if (roleView === "forbidden") return { error: "NOT_AUTHORIZED" }

  const record = new RegistryDatabase(input.projectDirectory, { readonly: true }).getMission(input.missionId)
  if (!record) return { error: "NO_CONTRACT" }

  const locale = input.locale ?? readLocaleSync(input.projectDirectory)
  const contract = registryMissionToContract(record)
  const markdownParts: string[] = []

  if (includesBoundaries(roleView)) {
    markdownParts.push(formatMissionContextBlock(contract, locale))
  }

  if (includesContract(roleView)) {
    const shown = visibleContract(contract, roleView)
    markdownParts.push(formatMissionContractForRole(shown, locale, contractAudience(roleView)))
  }

  if (includesBrief(roleView)) {
    const nodeId = input.sender?.nodeId
    if (nodeId) {
      const brief = await readNodeBriefRegistry(input.projectDirectory, input.missionId, nodeId)
      if (!brief) {
        markdownParts.push(
          `## Node brief · ${nodeId}\n\nNo node brief in registry for this node. The orchestrator must call ctx.run(..., { brief: ... }) before activating this node.`,
        )
      } else {
        markdownParts.push(formatNodeBriefBlock(brief, locale))
      }
    }
  }

  return {
    mission_id: input.missionId,
    role_view: roleView,
    markdown: markdownParts.join("\n\n"),
  }
}
