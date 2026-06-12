import type { TeamSpec } from "../tree/types.ts"
import type { MissionScriptMeta, OrchestrationState } from "./types.ts"

function isAncestor(team: TeamSpec, ancestorId: string, nodeId: string) {
  let current = team.nodes[nodeId]?.parent ?? null
  while (current) {
    if (current === ancestorId) return true
    current = team.nodes[current]?.parent ?? null
  }
  return false
}

function isDirectParent(team: TeamSpec, parentId: string, childId: string) {
  return team.nodes[childId]?.parent === parentId
}

export function validateReworkRequest(input: {
  team: TeamSpec
  meta?: MissionScriptMeta
  state: OrchestrationState
  requesterNodeId: string
  blockedByNodeId: string
}) {
  const { team, meta, state, requesterNodeId, blockedByNodeId } = input
  const policy = meta?.rework ?? { peer_allowed: true, escalate_to: "root" as const, allow_coordinator_rework: true }

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

  const parentOk = isDirectParent(team, blockedByNodeId, requesterNodeId)
  const ancestorOk = isAncestor(team, blockedByNodeId, requesterNodeId)
  const coordinatorOk =
    policy.allow_coordinator_rework !== false &&
    (isAncestor(team, requesterNodeId, blockedByNodeId) || isDirectParent(team, requesterNodeId, blockedByNodeId))

  if (policy.peer_allowed === false) {
    if (!parentOk && !(policy.escalate_to === "root" && blockedByNodeId === team.root)) {
      return { ok: false as const, code: "FORBIDDEN_REWORK", reason: "peer_allowed is false" }
    }
  } else if (!parentOk && !ancestorOk && !coordinatorOk) {
    return { ok: false as const, code: "FORBIDDEN_REWORK", reason: "no team relationship for rework" }
  }

  return { ok: true as const }
}
