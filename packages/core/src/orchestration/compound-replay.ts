import type { OrchestrationState } from "./types.ts"
import type { PlanStepOp } from "./plan-types.ts"

export function isCompoundPlanStepOp(op: PlanStepOp | undefined) {
  return op === "parallel" || op === "pipeline"
}

export function nodeIsDone(state: OrchestrationState, nodeId: string) {
  return state.nodes[nodeId]?.status === "done"
}

/** Skip duplicate reply prompts when replaying an incomplete parallel/pipeline step. */
export function shouldSkipCompoundReplyPrompt(
  state: OrchestrationState,
  nodeId: string,
  reactivationLatch: ReadonlySet<string>,
) {
  if (!nodeIsDone(state, nodeId)) return false
  return !reactivationLatch.has(nodeId)
}

/** Skip re-delivering an unchanged brief to an already-done node during compound replay. */
export function shouldSkipCompoundSetBriefDeliver(
  state: OrchestrationState,
  nodeId: string,
  briefChanged: boolean,
) {
  if (!nodeIsDone(state, nodeId)) return false
  return !briefChanged
}

/** Arm the next reply prompt when a done node receives a revised brief (multi-round inside compound). */
export function armCompoundReactivation(nodeId: string, reactivationLatch: Set<string>) {
  reactivationLatch.add(nodeId)
}

export function consumeCompoundReactivation(nodeId: string, reactivationLatch: Set<string>) {
  reactivationLatch.delete(nodeId)
}
