import type { OrchestrationState } from "../types.ts"
import { orchestrationAllDone, orchestrationProblemNodeIds } from "./store.ts"

export const ORCHESTRATION_STALL_THRESHOLD_MS = 3 * 60_000

export type OrchestrationStallKind = "sandbox_dead" | "orchestrator_stuck"

export type OrchestrationStall = {
  kind: OrchestrationStallKind
  staleMs: number
  phase?: string
}

/** Detect orchestrator heartbeat loss: no running nodes, mission incomplete, state stale. */
export function detectOrchestrationStall(input: {
  state: OrchestrationState
  sandboxRunning: boolean
  now: number
  stallThresholdMs?: number
}): OrchestrationStall | null {
  if (orchestrationAllDone(input.state)) return null

  const updatedAt = Date.parse(input.state.updated_at)
  if (!Number.isFinite(updatedAt)) return null
  const staleMs = input.now - updatedAt
  const threshold = input.stallThresholdMs ?? ORCHESTRATION_STALL_THRESHOLD_MS
  if (staleMs < threshold) return null

  if (!input.sandboxRunning) {
    return {
      kind: "sandbox_dead",
      staleMs,
      ...(input.state.phase && { phase: input.state.phase }),
    }
  }

  if (orchestrationProblemNodeIds(input.state).length > 0) return null

  return {
    kind: "orchestrator_stuck",
    staleMs,
    ...(input.state.phase && { phase: input.state.phase }),
  }
}
