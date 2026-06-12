import { tool, type PluginInput } from "@opencode-ai/plugin"
import { readActiveMissionContract, registryMissionToContract } from "../missions/contract.ts"
import { RegistryDatabase } from "../registry/db.ts"
import { getRegistryStore } from "../registry/context.ts"
import {
  INNER_COORDINATOR_AGENT,
  INNER_EXECUTION_AGENT,
  INNER_ROOT_AGENT,
  INNER_ROOT_SOLO_AGENT,
} from "../registry/types.ts"
import type { RegistryAgent } from "../registry/types.ts"
import { readLocaleSync } from "../locale.ts"
import { formatMissionContextBlock } from "../execution/context.ts"
import { formatNodeBriefBlock } from "../execution/brief.ts"
import {
  readMissionContractRawRegistry,
  readMissionRawDoneWhen,
  readNodeBriefRegistry,
} from "../execution/artifacts.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"

function resolveMissionId(
  sender: RegistryAgent | undefined,
  store: Awaited<ReturnType<typeof getRegistryStore>>,
  missionIdArg?: string,
) {
  return missionIdArg ?? sender?.missionId ?? store.getActiveMission()?.missionId
}

function isInnerCoordinator(profile?: string) {
  return (
    profile === INNER_ROOT_AGENT ||
    profile === INNER_ROOT_SOLO_AGENT ||
    profile === INNER_COORDINATOR_AGENT
  )
}

export function missionContextTool(input: PluginInput) {
  return tool({
    description:
      "Read Mission Context (shared objective and must_not boundaries). Primary mission boundary for all execution nodes.",
    args: {
      mission_id: tool.schema.string().optional().describe("Mission id; default active mission"),
    },
    async execute(args, context) {
      const toolName = "gatehouse_mission_context"
      try {
        const store = await getRegistryStore(input)
        const sender = store.bySession(context.sessionID)
        const missionId = resolveMissionId(sender, store, args.mission_id)
        if (!missionId) {
          return { output: toolFail(toolName, "NO_MISSION", "No mission_id"), ...toolMetadata(toolName) }
        }

        const contract = readActiveMissionContract(input.directory, missionId)
        if (!contract) {
          return {
            output: toolFail(toolName, "NO_CONTRACT", `No registry contract for mission ${missionId}`),
            ...toolMetadata(toolName),
          }
        }

        const locale = readLocaleSync(input.directory)
        return {
          output: toolOk(toolName, {
            mission_id: missionId,
            markdown: formatMissionContextBlock(contract, locale),
            objective: contract.objective,
            must_not: contract.must_not,
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "MISSION_CONTEXT_FAILED", message), ...toolMetadata(toolName) }
      }
    },
  })
}

export function nodeBriefTool(input: PluginInput) {
  return tool({
    description:
      "Read Node Brief for an execution node (your_work, not_your_job, acceptance_slice). Inner leaves may only read their own node.",
    args: {
      node_id: tool.schema.string().optional().describe("Node id; default caller node"),
      mission_id: tool.schema.string().optional().describe("Mission id; default active mission"),
    },
    async execute(args, context) {
      const toolName = "gatehouse_node_brief"
      try {
        const store = await getRegistryStore(input)
        const sender = store.bySession(context.sessionID)
        const missionId = resolveMissionId(sender, store, args.mission_id)
        if (!missionId) {
          return { output: toolFail(toolName, "NO_MISSION", "No mission_id"), ...toolMetadata(toolName) }
        }

        const nodeId = args.node_id ?? sender?.nodeId
        if (!nodeId) {
          return { output: toolFail(toolName, "NO_NODE", "node_id required"), ...toolMetadata(toolName) }
        }

        if (
          sender?.scope === "inner" &&
          sender.profile === INNER_EXECUTION_AGENT &&
          sender.nodeId &&
          nodeId !== sender.nodeId
        ) {
          return {
            output: toolFail(toolName, "FORBIDDEN_NODE", "Inner leaf may only read its own node brief"),
            ...toolMetadata(toolName),
          }
        }

        const brief = await readNodeBriefRegistry(input.directory, missionId, nodeId)
        if (!brief) {
          return {
            output: toolOk(toolName, {
              mission_id: missionId,
              node_id: nodeId,
              status: "not_found",
              note:
                "No node brief in registry for this node. The orchestrator must call ctx.setBrief(...) before prompt(reply:true) for this node.",
            }),
            ...toolMetadata(toolName),
          }
        }

        return {
          output: toolOk(toolName, {
            mission_id: missionId,
            node_id: nodeId,
            brief,
            markdown: formatNodeBriefBlock(brief),
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "NODE_BRIEF_FAILED", message), ...toolMetadata(toolName) }
      }
    },
  })
}

export function missionContractTool(input: PluginInput) {
  return tool({
    description:
      "Read frozen mission contract from registry.db. Coordinators and outer team get full contract; inner leaves get a summary view only.",
    args: {
      mission_id: tool.schema.string().optional().describe("Mission id; default active mission"),
    },
    async execute(args, context) {
      const toolName = "gatehouse_mission_contract"
      try {
        const store = await getRegistryStore(input)
        const sender = store.bySession(context.sessionID)
        const missionId = resolveMissionId(sender, store, args.mission_id)
        if (!missionId) {
          return { output: toolFail(toolName, "NO_MISSION", "No mission_id"), ...toolMetadata(toolName) }
        }

        const record = new RegistryDatabase(input.directory, { readonly: true }).getMission(missionId)
        if (!record) {
          return {
            output: toolFail(toolName, "NO_CONTRACT", `No registry mission ${missionId}`),
            ...toolMetadata(toolName),
          }
        }

        const contract = registryMissionToContract(record)
        const rawDoneWhen = await readMissionRawDoneWhen(input.directory, missionId)
        const rawEntry = await readMissionContractRawRegistry(input.directory, missionId)

        const fullView = sender?.scope !== "inner" || isInnerCoordinator(sender.profile)
        if (!fullView) {
          return {
            output: toolOk(toolName, {
              mission_id: missionId,
              view: "summary",
              objective: contract.objective,
              must_not: contract.must_not,
              note: "Inner leaf: act on gatehouse_node_brief; coordinators may read full contract",
            }),
            ...toolMetadata(toolName),
          }
        }

        return {
          output: toolOk(toolName, {
            mission_id: missionId,
            view: "full",
            contract,
            ...(rawDoneWhen && { done_when_raw: rawDoneWhen }),
            ...(rawEntry && { contract_raw: rawEntry }),
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "MISSION_CONTRACT_FAILED", message), ...toolMetadata(toolName) }
      }
    },
  })
}
