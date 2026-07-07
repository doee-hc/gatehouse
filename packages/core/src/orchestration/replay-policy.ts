import type { PlanStepOp } from "./plan-types.ts"
import type { CompoundReplayState, OrchestrationState } from "./types.ts"
import { isReplayStepComplete } from "./replay-cursor.ts"
import { nodeAlreadyActivated } from "./state.ts"

export type PlanStepKind = "linear" | "compound"

export function planStepKind(op: PlanStepOp | undefined): PlanStepKind {
  return op === "parallel" || op === "pipeline" ? "compound" : "linear"
}

export function nodeIsDone(state: OrchestrationState, nodeId: string) {
  return state.nodes[nodeId]?.status === "done"
}

export function compoundReactivatedNodes(
  compound: CompoundReplayState | undefined,
  stepId: string | undefined,
): ReadonlySet<string> {
  if (!stepId || !compound || compound.step_id !== stepId) return new Set()
  return new Set(compound.reactivated)
}

export function armCompoundReactivation(
  state: OrchestrationState,
  stepId: string,
  nodeId: string,
) {
  const current = state.compound_replay
  const reactivated =
    current?.step_id === stepId ? new Set(current.reactivated) : new Set<string>()
  reactivated.add(nodeId)
  state.compound_replay = { step_id: stepId, reactivated: [...reactivated] }
}

export function consumeCompoundReactivation(state: OrchestrationState, stepId: string, nodeId: string) {
  const current = state.compound_replay
  if (!current || current.step_id !== stepId) return
  const reactivated = current.reactivated.filter((id) => id !== nodeId)
  if (reactivated.length === 0) delete state.compound_replay
  else state.compound_replay = { step_id: stepId, reactivated }
}

export type ReplayPromptDecision = "deliver" | "skip"

export function decideReplyPrompt(input: {
  state: OrchestrationState
  nodeId: string
  hasPlanStep: boolean
  stepIndex?: number
  stepKind: PlanStepKind
  reactivated: ReadonlySet<string>
}): ReplayPromptDecision {
  const { state, nodeId, hasPlanStep, stepIndex, stepKind, reactivated } = input

  if (!hasPlanStep) {
    return nodeAlreadyActivated(state, nodeId) ? "skip" : "deliver"
  }

  if (stepIndex !== undefined && isReplayStepComplete(state, stepIndex)) {
    return "skip"
  }

  if (stepKind === "compound" && nodeIsDone(state, nodeId) && !reactivated.has(nodeId)) {
    return "skip"
  }

  return "deliver"
}

export function shouldArmCompoundReactivation(input: {
  stepKind: PlanStepKind
  briefChanged: boolean
  state: OrchestrationState
  nodeId: string
}) {
  return (
    input.stepKind === "compound" &&
    input.briefChanged &&
    nodeIsDone(input.state, input.nodeId)
  )
}
