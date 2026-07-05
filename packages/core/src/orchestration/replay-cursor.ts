import type { PlanStep } from "./plan-types.ts"
import type { OrchestrationState } from "./types.ts"

/** Steps with index < next_step_index are fully complete. */
export function replayNextStepIndex(state: OrchestrationState | undefined) {
  return state?.cursor_step_index ?? 0
}

export function isReplayStepComplete(state: OrchestrationState | undefined, stepIndex: number) {
  return stepIndex < replayNextStepIndex(state)
}

export function isReplayStepIdComplete(
  state: OrchestrationState | undefined,
  stepId: string,
  steps: readonly PlanStep[],
) {
  const index = steps.findIndex((step) => step.id === stepId)
  return index >= 0 && isReplayStepComplete(state, index)
}

export function advanceReplayCursor(
  state: OrchestrationState,
  _stepId: string,
  stepIndex: number,
  _steps: readonly PlanStep[],
) {
  state.cursor_step_index = Math.max(replayNextStepIndex(state), stepIndex + 1)
  if (state.compound_replay?.step_id === _stepId) {
    delete state.compound_replay
  }
}

export function resetReplayCursor(state: OrchestrationState) {
  state.cursor_step_index = 0
  delete state.compound_replay
}
