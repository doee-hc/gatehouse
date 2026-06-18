import { tool, type PluginInput } from "@opencode-ai/plugin"
import { getRegistryStore } from "../registry/context.ts"
import { orchestrationComplete, orchestrationRework } from "../orchestration/events.ts"
import { isMissionTerminalNode } from "../orchestration/plan-graph.ts"
import { parseArtifactsInput, parseRisksInput } from "../orchestration/completion.ts"
import { hasOrchestrationRuntime, readOrchestrationState } from "../orchestration/state.ts"
import type { NodeCompletion } from "../orchestration/types.ts"
import {
  formatPrecheckSummary,
  precheckHasUnmet,
  runDeliveryPrecheck,
} from "../delivery/criteria.ts"
import { parseEvidenceInput } from "../delivery/evidence.ts"
import { submitDeliveryOnRootComplete } from "../delivery/root-complete.ts"
import { buildCriteriaForMission } from "../delivery/store.ts"
import { readMissionsDocument } from "../missions/store.ts"
import { RegistryDatabase } from "../registry/db.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"
import { summarizeExecutionNodes } from "./helpers.ts"

function allOtherNodesDone(
  state: NonNullable<ReturnType<typeof readOrchestrationState>>,
  nodeId: string,
) {
  return Object.entries(state.nodes).every(([id, entry]) => id === nodeId || entry.status === "done")
}

export function executionCompleteTool(input: PluginInput) {
  return tool({
    description:
      "Signal that this execution node finished its Node Brief work. Advances orchestration (unblocks nodes waiting on you). Structural root: when all nodes are done, runs done_when precheck, records delivery, and notifies lead automatically. Put deliverables in the project tree; pass artifact paths with descriptions in artifacts.",
    args: {
      summary: tool.schema.string().min(1).describe("Short completion summary (required)"),
      artifacts: tool.schema
        .array(
          tool.schema.object({
            path: tool.schema.string(),
            description: tool.schema.string(),
          }),
        )
        .optional()
        .describe("Project deliverable paths with descriptions"),
      risks: tool.schema.array(tool.schema.string()).optional().describe("Open risks or unfinished items; omit if none"),
      force_reason: tool.schema
        .string()
        .optional()
        .describe("Structural root only, final delivery: required when done_when precheck has unmet items"),
      evidence: tool.schema
        .array(
          tool.schema.object({
            criterion_id: tool.schema.number(),
            status: tool.schema.enum(["met", "unmet", "partial", "skipped"]),
            proof: tool.schema.string().optional(),
          }),
        )
        .optional()
        .describe("Structural root only, final delivery: evidence per criterion"),
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
        const summary = args.summary.trim()
        const scriptDb = new RegistryDatabase(input.directory, { readonly: true })
        const scriptRecord = scriptDb.getMissionScript(missionId)
        const plan = scriptDb.getLatestOrchestrationPlan(missionId)
        const isTerminal = isMissionTerminalNode(nodeId, plan)

        let artifacts: ReturnType<typeof parseArtifactsInput>
        let risks: ReturnType<typeof parseRisksInput>
        let evidence: ReturnType<typeof parseEvidenceInput>
        try {
          artifacts = parseArtifactsInput(args.artifacts)
          risks = parseRisksInput(args.risks)
          evidence = parseEvidenceInput(args.evidence)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return { output: toolFail(toolName, "INVALID_COMPLETION", message), ...toolMetadata(toolName) }
        }

        if (!hasOrchestrationRuntime(input.directory, missionId)) {
          return {
            output: toolFail(
              toolName,
              "NO_ORCHESTRATION",
              "Mission has no orchestration runtime; ensure mission.script.ts was submitted via gatehouse_submit_orchestration",
            ),
            ...toolMetadata(toolName),
          }
        }

        const state = readOrchestrationState(input.directory, missionId)
        const node = state?.nodes[nodeId]
        const finalRootDelivery = Boolean(isTerminal && state && allOtherNodesDone(state, nodeId))

        if (finalRootDelivery) {
          const missionsDoc = await readMissionsDocument(input.directory)
          const mission = missionsDoc.missions.find((entry) => entry.id === missionId)
          if (!mission) {
            return {
              output: toolFail(toolName, "MISSION_NOT_FOUND", `Mission not found in missions.yaml: ${missionId}`),
              ...toolMetadata(toolName),
            }
          }
          if (mission.status !== "running") {
            return {
              output: toolFail(
                toolName,
                "MISSION_NOT_RUNNING",
                `Mission ${missionId} must be running to deliver (current: ${mission.status})`,
              ),
              ...toolMetadata(toolName),
            }
          }
          const criteria = await buildCriteriaForMission(input.directory, missionId, mission)
          const precheck = await runDeliveryPrecheck(input.directory, criteria)
          if (precheckHasUnmet(precheck) && !args.force_reason?.trim()) {
            const failed = precheck.filter((item) => item.status === "unmet")
            return {
              output: toolFail(
                toolName,
                "DONE_WHEN_PRECHECK_FAILED",
                `done_when precheck failed for ${failed.length} criterion(s); fix issues or pass force_reason`,
                { precheck: formatPrecheckSummary(precheck, criteria) },
              ),
              ...toolMetadata(toolName),
            }
          }
        }

        const completion: NodeCompletion = {
          summary,
          completed_at: new Date().toISOString(),
          ...(artifacts?.length && { artifacts }),
          ...(risks?.length && { risks }),
          ...(node?.round !== undefined && { round: node.round }),
        }

        const result = await orchestrationComplete({
          plugin: input,
          store,
          missionId,
          nodeId,
          completion,
          skipAcceptanceSlice: Boolean(isTerminal && state && allOtherNodesDone(state, nodeId)),
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
        if (result.status === "acceptance_precheck_failed") {
          return {
            output: toolFail(toolName, "ACCEPTANCE_PRECHECK_FAILED", result.message, {
              node_id: result.node_id,
              precheck: result.precheck,
            }),
            ...toolMetadata(toolName),
          }
        }

        let delivery:
          | Awaited<ReturnType<typeof submitDeliveryOnRootComplete>>
          | undefined
        if (isTerminal && result.all_done) {
          try {
            delivery = await submitDeliveryOnRootComplete({
              plugin: input,
              store,
              missionId,
              nodeId,
              summary,
              senderSessionId: context.sessionID,
              senderProfile: context.agent,
              senderAgentId: sender.agentId,
              forceReason: args.force_reason,
              evidence,
            })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const code = message.includes("Precheck failed") ? "PRECHECK_FAILED" : "DELIVERY_FAILED"
            return { output: toolFail(toolName, code, message), ...toolMetadata(toolName) }
          }
        }

        await store.flushPendingDeliveries()

        return {
          output: toolOk(toolName, {
            node_id: result.node_id,
            activated: "activated" in result ? result.activated : result.unblocked,
            all_nodes_done: result.all_done,
            ...(delivery && {
              delivery_version: delivery.record.version,
              delivery_status: delivery.record.status,
              lead_delivery: delivery.lead_delivery,
            }),
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
      "In-flight correction: reopen a dependency (blocked_by) and block yourself until it calls gatehouse_execution_complete again. Scope is only what you put in reason — not a full redo. You must still be running. Do not use after you already completed this phase.",
    args: {
      blocked_by: tool.schema.string().min(1).describe("node_id of the dependency to reopen for correction"),
      reason: tool.schema
        .string()
        .min(1)
        .describe(
          "Minimal correction scope (good: 'Fix README.md Install section only: pin bun version'; bad: 'Output wrong, redo everything')",
        ),
      evidence_path: tool.schema.string().optional().describe("Optional path to project artifact or log evidence"),
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
              "Mission has no orchestration runtime; ensure mission.script.ts was submitted via gatehouse_submit_orchestration",
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
      "Read orchestration runtime state (node statuses, phase, completions, running/done/blocked/rework). For lead and architect during running missions.",
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
            phase: state.phase,
            nodes: summarizeExecutionNodes(state.nodes),
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
