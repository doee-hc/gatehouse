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

/** Keep completed_step_ids derived from cursor for legacy readers (Portal, etc.). */
export function syncCompletedStepIds(state: OrchestrationState, steps: readonly PlanStep[]) {
  const next = replayNextStepIndex(state)
  state.completed_step_ids = steps.slice(0, next).map((step) => step.id)
}

export function advanceReplayCursor(
  state: OrchestrationState,
  stepId: string,
  stepIndex: number,
  steps: readonly PlanStep[],
) {
  state.cursor_step_index = Math.max(replayNextStepIndex(state), stepIndex + 1)
  syncCompletedStepIds(state, steps)
  if (state.compound_replay?.step_id === stepId) {
    delete state.compound_replay
  }
}

export function normalizeReplayCursor(state: OrchestrationState, steps: readonly PlanStep[]) {
  if (state.cursor_step_index === undefined) state.cursor_step_index = 0
  const next = replayNextStepIndex(state)
  const idsFromCursor = steps.slice(0, next).map((step) => step.id)
  const legacyIds = state.completed_step_ids ?? []
  if (legacyIds.length > idsFromCursor.length) {
    const legacyMax = legacyIds.reduce((max, id) => {
      const index = steps.findIndex((step) => step.id === id)
      return index >= 0 ? Math.max(max, index + 1) : max
    }, next)
    state.cursor_step_index = Math.max(next, legacyMax)
  }
  syncCompletedStepIds(state, steps)
}

export function resetReplayCursor(state: OrchestrationState) {
  state.cursor_step_index = 0
  state.completed_step_ids = []
  delete state.compound_replay
}
