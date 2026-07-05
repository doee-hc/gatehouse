import { createHash } from "node:crypto"
import { resetReplayCursor } from "./replay-cursor.ts"
import type { OrchestrationState } from "./types.ts"
import type { OrchestrationBaseline, OrchestrationBaselineNode } from "./plan-types.ts"

export function captureOrchestrationBaseline(input: {
  missionId: string
  state: OrchestrationState
  parentMissionId?: string
  deliveryVersion?: number
}): OrchestrationBaseline {
  const nodes: OrchestrationBaselineNode[] = []
  for (const [nodeId, node] of Object.entries(input.state.nodes)) {
    if (node.status !== "done") continue
    nodes.push({
      node_id: nodeId,
      status: "done",
      ...(node.completed_at && { completed_at: node.completed_at }),
      ...(node.completion?.summary && { summary: node.completion.summary }),
    })
  }
  const capturedAt = new Date().toISOString()
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        mission_id: input.missionId,
        nodes: nodes.map((node) => node.node_id).sort(),
        captured_at: capturedAt,
      }),
    )
    .digest("hex")
    .slice(0, 12)

  return {
    baseline_id: `${input.missionId}@baseline-${digest}`,
    mission_id: input.missionId,
    captured_at: capturedAt,
    ...(input.parentMissionId && { parent_mission_id: input.parentMissionId }),
    ...(input.deliveryVersion !== undefined && { delivery_version: input.deliveryVersion }),
    nodes,
  }
}

export function baselineNodeIds(baseline: OrchestrationBaseline) {
  return new Set(baseline.nodes.map((node) => node.node_id))
}

export function applyBaselineToState(state: OrchestrationState, baseline: OrchestrationBaseline) {
  state.baseline_id = baseline.baseline_id
  for (const entry of baseline.nodes) {
    const existing = state.nodes[entry.node_id]
    if (!existing || existing.status !== "done") {
      state.nodes[entry.node_id] = {
        status: "done",
        ...(entry.completed_at && { completed_at: entry.completed_at }),
        ...(entry.summary && {
          completion: {
            summary: entry.summary,
            completed_at: entry.completed_at ?? new Date().toISOString(),
          },
        }),
      }
    }
  }
}

export function resetOrchestrationForContinuation(state: OrchestrationState, baseline: OrchestrationBaseline) {
  const frozen = baselineNodeIds(baseline)
  for (const [nodeId, node] of Object.entries(state.nodes)) {
    if (frozen.has(nodeId)) continue
    state.nodes[nodeId] = { status: "pending" }
  }
  resetReplayCursor(state)
  state.sandbox = {
    ...(state.sandbox ?? { status: "stopped" as const }),
    status: "stopped",
    stopped_at: undefined,
    last_error: undefined,
  }
}
