import type { OrchestrationNodeState } from "../orchestration/types.ts"
import type { RegistryAgent } from "../registry/types.ts"

export function summarizeExecutionNodes(nodes: Record<string, OrchestrationNodeState>) {
  return Object.fromEntries(
    Object.entries(nodes).map(([id, node]) => [
      id,
      {
        status: node.status,
        ...(node.blocked_by && { blocked_by: node.blocked_by }),
        ...(node.rework_reason && { rework_reason: node.rework_reason }),
      },
    ]),
  )
}

export function slimInspectorRequester(agent: RegistryAgent | undefined) {
  if (!agent) return undefined
  return {
    profile: agent.profile,
    display_name: agent.displayName,
    ...(agent.missionId && { mission_id: agent.missionId }),
    ...(agent.nodeId && { node_id: agent.nodeId }),
  }
}

export function slimParallelRunStatus(status: {
  status: string
  pending?: unknown[]
  allDone?: boolean
}) {
  if (status.status !== "ok") return { status: status.status }
  return {
    all_done: status.allDone ?? false,
    remaining: status.pending?.length ?? 0,
  }
}

export function parseFailedCriteriaInput(raw: number[] | undefined): number[] | undefined {
  if (!raw?.length) return undefined
  return raw.filter((item) => Number.isInteger(item))
}
