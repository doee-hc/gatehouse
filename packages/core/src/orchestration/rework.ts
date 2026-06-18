import type { OrchestrationPlan } from "./plan-types.ts"
import { upstreamDependsOnNodes } from "./plan-graph.ts"
import type { TeamSpec } from "../tree/types.ts"
import type { OrchestrationState } from "./types.ts"

export function validateReworkRequest(input: {
  team: TeamSpec
  plan?: OrchestrationPlan
  state: OrchestrationState
  requesterNodeId: string
  blockedByNodeId: string
}) {
  const { team, plan, state, requesterNodeId, blockedByNodeId } = input

  if (!team.nodes[blockedByNodeId]) {
    return { ok: false as const, code: "UNKNOWN_BLOCKER", node_id: blockedByNodeId }
  }
  if (!team.nodes[requesterNodeId]) {
    return { ok: false as const, code: "UNKNOWN_REQUESTER", node_id: requesterNodeId }
  }

  const requester = state.nodes[requesterNodeId]
  if (!requester || requester.status !== "running") {
    return { ok: false as const, code: "NOT_RUNNING", node_id: requesterNodeId, current: requester?.status }
  }

  const blocker = state.nodes[blockedByNodeId]
  if (!blocker || (blocker.status !== "done" && blocker.status !== "running")) {
    return {
      ok: false as const,
      code: "INVALID_BLOCKER_STATE",
      node_id: blockedByNodeId,
      current: blocker?.status,
    }
  }

  if (requesterNodeId === blockedByNodeId) {
    return { ok: false as const, code: "SELF_REWORK" }
  }

  if (!plan) {
    return { ok: false as const, code: "FORBIDDEN_REWORK", reason: "orchestration plan missing" }
  }

  const upstream = upstreamDependsOnNodes(plan, requesterNodeId)
  if (!upstream.has(blockedByNodeId)) {
    return {
      ok: false as const,
      code: "FORBIDDEN_REWORK",
      reason: "rework allowed only for dependsOn upstream nodes",
    }
  }

  return { ok: true as const }
}
