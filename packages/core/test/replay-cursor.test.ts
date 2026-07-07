import { describe, expect, test } from "bun:test"
import type { OrchestrationPlan } from "../src/orchestration/plan/types.ts"
import {
  advanceReplayCursor,
  isReplayStepComplete,
  replayNextStepIndex,
  resetReplayCursor,
} from "../src/orchestration/plan/replay.ts"
import { initOrchestrationState } from "../src/orchestration/state/store.ts"

const steps: OrchestrationPlan["steps"] = [
  { id: "step-0", op: "run", statement: 'await ctx.run("a")' },
  { id: "step-1", op: "parallel", statement: "await ctx.parallel([])" },
  { id: "step-2", op: "run", statement: 'await ctx.run("b")' },
]

describe("replay cursor", () => {
  test("advanceReplayCursor moves next index", () => {
    const state = initOrchestrationState("m1", ["a", "b"])
    expect(replayNextStepIndex(state)).toBe(0)

    advanceReplayCursor(state, "step-0", 0, steps)
    expect(replayNextStepIndex(state)).toBe(1)
    expect(isReplayStepComplete(state, 0)).toBe(true)
    expect(isReplayStepComplete(state, 1)).toBe(false)
  })

  test("resetReplayCursor clears compound replay latch", () => {
    const state = initOrchestrationState("m1", ["a"])
    state.cursor_step_index = 2
    state.compound_replay = { step_id: "step-1", reactivated: ["a"] }
    resetReplayCursor(state)
    expect(replayNextStepIndex(state)).toBe(0)
    expect(state.compound_replay).toBeUndefined()
  })
})
