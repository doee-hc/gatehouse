import { tool, type PluginInput } from "@opencode-ai/plugin"
import { getRegistryStore } from "../registry/context.ts"
import { orchestrationComplete, orchestrationRework } from "../orchestration/events.ts"
import { hasOrchestrationRuntime, readOrchestrationState } from "../orchestration/state.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"

export function executionCompleteTool(input: PluginInput) {
  return tool({
    description:
      "Signal that this execution node finished its Node Brief work. Advances orchestration (unblocks nodes waiting on you). Use after writing node delivery report when applicable.",
    args: {
      summary: tool.schema.string().optional().describe("Short completion summary"),
      delivery_path: tool.schema
        .string()
        .optional()
        .describe("Path to reports/nodes/<node_id>-delivery.md if written"),
    },
    async execute(args, context) {
      const toolName = "gatehouse_execution_complete"
      try {
        const store = await getRegistryStore(input)
        const sender = store.bySession(context.sessionID)
        if (!sender || sender.scope !== "inner" || !sender.missionId || !sender.nodeId) {
          return {
            output: toolFail(toolName, "NOT_INNER_NODE", "Only inner execution nodes may call this tool"),
            ...toolMetadata(toolName),
          }
        }

        const missionId = sender.missionId
        const nodeId = sender.nodeId
        const deliveryPath = args.delivery_path

        if (!hasOrchestrationRuntime(input.directory, missionId)) {
          return {
            output: toolFail(
              toolName,
              "NO_ORCHESTRATION",
              "Mission has no orchestration runtime; ensure mission.script.ts was bootstrapped",
            ),
            ...toolMetadata(toolName),
          }
        }

        const result = await orchestrationComplete({
          plugin: input,
          store,
          missionId,
          nodeId,
          ...(deliveryPath && { deliveryPath }),
        })

        if (result.status === "no_orchestration") {
          return {
            output: toolFail(toolName, "NO_ORCHESTRATION", "Orchestration runtime missing for this mission"),
            ...toolMetadata(toolName),
          }
        }
        if (result.status === "no_state") {
          return { output: toolFail(toolName, "NO_STATE", "Execution state missing"), ...toolMetadata(toolName) }
        }
        if (result.status === "unknown_node") {
          return {
            output: toolFail(toolName, "UNKNOWN_NODE", `Node not in orchestration: ${result.node_id}`),
            ...toolMetadata(toolName),
          }
        }
        if (result.status === "not_active") {
          return {
            output: toolFail(toolName, "NOT_ACTIVE", `Node status is ${result.current}; cannot complete`),
            ...toolMetadata(toolName),
          }
        }

        await store.flushPendingDeliveries()

        return {
          output: toolOk(toolName, {
            node_id: result.node_id,
            activated: "activated" in result ? result.activated : result.unblocked,
            all_nodes_done: result.all_done,
            ...(args.summary && { summary: args.summary }),
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "EXECUTION_COMPLETE_FAILED", message), ...toolMetadata(toolName) }
      }
    },
  })
}

export function executionReworkTool(input: PluginInput) {
  return tool({
    description:
      "In-flight correction: reopen a dependency (blocked_by) and block yourself until it calls gatehouse_execution_complete again. Scope is only what you put in reason — not a full redo. You must still be running. Do not use for Q&A or nudges while the peer is still working — gatehouse_send_message. Do not use after you already completed this phase.",
    args: {
      blocked_by: tool.schema.string().min(1).describe("node_id of the dependency to reopen for correction"),
      reason: tool.schema
        .string()
        .min(1)
        .describe(
          "Minimal correction scope (good: 'Fix README.md Install section only: pin bun version'; bad: 'Output wrong, redo everything')",
        ),
      evidence_path: tool.schema.string().optional().describe("Optional path to delivery or log evidence"),
    },
    async execute(args, context) {
      const toolName = "gatehouse_execution_rework"
      try {
        const store = await getRegistryStore(input)
        const sender = store.bySession(context.sessionID)
        if (!sender || sender.scope !== "inner" || !sender.missionId || !sender.nodeId) {
          return {
            output: toolFail(toolName, "NOT_INNER_NODE", "Only inner execution nodes may call this tool"),
            ...toolMetadata(toolName),
          }
        }

        const missionId = sender.missionId
        const requesterNodeId = sender.nodeId
        const evidencePath = args.evidence_path

        if (!hasOrchestrationRuntime(input.directory, missionId)) {
          return {
            output: toolFail(
              toolName,
              "NO_ORCHESTRATION",
              "Mission has no orchestration runtime; ensure mission.script.ts was bootstrapped",
            ),
            ...toolMetadata(toolName),
          }
        }

        const result = await orchestrationRework({
          plugin: input,
          store,
          missionId,
          requesterNodeId,
          blockedByNodeId: args.blocked_by,
          reason: args.reason,
          ...(evidencePath && { evidencePath }),
        })

        if (result.status === "no_orchestration") {
          return {
            output: toolFail(toolName, "NO_ORCHESTRATION", "Orchestration runtime missing for this mission"),
            ...toolMetadata(toolName),
          }
        }
        if (result.status === "no_state") {
          return { output: toolFail(toolName, "NO_STATE", "Execution state missing"), ...toolMetadata(toolName) }
        }
        if (result.status === "UNKNOWN_BLOCKER" || result.status === "unknown_blocker") {
          return {
            output: toolFail(toolName, "UNKNOWN_BLOCKER", `Blocker node not in team: ${result.node_id}`),
            ...toolMetadata(toolName),
          }
        }
        if (result.status === "unknown_requester") {
          return {
            output: toolFail(toolName, "UNKNOWN_REQUESTER", `Requester node not in team: ${result.node_id}`),
            ...toolMetadata(toolName),
          }
        }
        if (result.status === "forbidden") {
          return {
            output: toolFail(toolName, "REWORK_FORBIDDEN", result.reason ?? "Rework not allowed"),
            ...toolMetadata(toolName),
          }
        }
        if (result.status === "not_active") {
          return {
            output: toolFail(toolName, "NOT_ACTIVE", `Node status is ${result.current}; cannot request rework`),
            ...toolMetadata(toolName),
          }
        }

        await store.flushPendingDeliveries()

        return {
          output: toolOk(toolName, {
            reopened: result.reopened,
            blocked: result.blocked,
            delivery: result.delivery,
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "EXECUTION_REWORK_FAILED", message), ...toolMetadata(toolName) }
      }
    },
  })
}

export function executionStatusTool(input: PluginInput) {
  return tool({
    description:
      "Read orchestration runtime state (node statuses, phase, running/done/blocked/rework). For root, coordinators, lead, architect during running missions.",
    args: {
      mission_id: tool.schema.string().optional().describe("Mission id; default active mission"),
    },
    async execute(args, context) {
      const toolName = "gatehouse_execution_status"
      try {
        const store = await getRegistryStore(input)
        const sender = store.bySession(context.sessionID)
        if (!sender) {
          return { output: toolFail(toolName, "NOT_REGISTERED", "Session not in registry"), ...toolMetadata(toolName) }
        }

        const missionId =
          args.mission_id ??
          sender.missionId ??
          store.getActiveMission()?.missionId
        if (!missionId) {
          return { output: toolFail(toolName, "NO_MISSION", "No mission_id"), ...toolMetadata(toolName) }
        }

        if (!hasOrchestrationRuntime(input.directory, missionId)) {
          return {
            output: toolOk(toolName, {
              mission_id: missionId,
              status: "no_runtime",
              note: "No orchestration runtime for this mission",
            }),
            ...toolMetadata(toolName),
          }
        }

        const state = readOrchestrationState(input.directory, missionId)
        if (!state) {
          return {
            output: toolOk(toolName, {
              mission_id: missionId,
              status: "no_runtime",
              orchestration: true,
              note: "Orchestration script registered but state missing",
            }),
            ...toolMetadata(toolName),
          }
        }
        return {
          output: toolOk(toolName, {
            mission_id: missionId,
            orchestration: true,
            phase: state.phase,
            updated_at: state.updated_at,
            nodes: state.nodes,
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "EXECUTION_STATUS_FAILED", message), ...toolMetadata(toolName) }
      }
    },
  })
}
