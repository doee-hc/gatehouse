import { describe, expect, test } from "bun:test"
import type { OrchestrationState } from "../src/orchestration/types.ts"
import {
  detectOrchestrationStall,
  ORCHESTRATION_STALL_THRESHOLD_MS,
} from "../src/orchestration/stall.ts"

function orchState(input: {
  updated_at: string
  nodes: OrchestrationState["nodes"]
  phase?: string
}): OrchestrationState {
  return {
    schema_version: 3,
    mission_id: "m1",
    updated_at: input.updated_at,
    phase: input.phase ?? "phase-one",
    nodes: input.nodes,
  }
}

describe("detectOrchestrationStall", () => {
  const now = ORCHESTRATION_STALL_THRESHOLD_MS + 10_000
  const staleUpdatedAt = new Date(now - ORCHESTRATION_STALL_THRESHOLD_MS - 1000).toISOString()

  test("returns null when all nodes are done", () => {
    const state = orchState({
      updated_at: staleUpdatedAt,
      nodes: {
        a: { status: "done" },
        b: { status: "done" },
      },
    })
    expect(detectOrchestrationStall({ state, sandboxRunning: false, now })).toBe(null)
  })

  test("returns null when state is fresh", () => {
    const state = orchState({
      updated_at: new Date(now - 1000).toISOString(),
      nodes: {
        a: { status: "pending" },
      },
    })
    expect(detectOrchestrationStall({ state, sandboxRunning: true, now })).toBe(null)
  })

  test("detects sandbox_dead even with running inner nodes", () => {
    const state = orchState({
      updated_at: staleUpdatedAt,
      nodes: {
        a: { status: "running" },
        b: { status: "pending" },
      },
    })
    const stall = detectOrchestrationStall({ state, sandboxRunning: false, now })
    expect(stall?.kind).toBe("sandbox_dead")
    expect(stall?.phase).toBe("phase-one")
    expect((stall?.staleMs ?? 0) > ORCHESTRATION_STALL_THRESHOLD_MS).toBe(true)
  })

  test("returns null for running sandbox with active inner nodes", () => {
    const state = orchState({
      updated_at: staleUpdatedAt,
      nodes: {
        a: { status: "running" },
        b: { status: "pending" },
      },
    })
    expect(detectOrchestrationStall({ state, sandboxRunning: true, now })).toBe(null)
  })

  test("detects orchestrator_stuck when sandbox runs but no inner node is active", () => {
    const state = orchState({
      updated_at: staleUpdatedAt,
      nodes: {
        a: { status: "done" },
        b: { status: "pending" },
      },
    })
    const stall = detectOrchestrationStall({ state, sandboxRunning: true, now })
    expect(stall?.kind).toBe("orchestrator_stuck")
    expect(stall?.phase).toBe("phase-one")
    expect((stall?.staleMs ?? 0) > ORCHESTRATION_STALL_THRESHOLD_MS).toBe(true)
  })
})
