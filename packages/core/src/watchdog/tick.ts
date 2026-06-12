import type { NodeWatchState } from "./signals.ts"

export const WATCHDOG_IDLE_THRESHOLD_MS = 10_000
export const WATCHDOG_POLL_MS = 2_000
export const WATCHDOG_WAKE_COOLDOWN_MS = 30_000

/** Mission-level idle gate (retro/skill record watchdogs). */
export function watchdogIdleTickDecision(input: {
  now: number
  allIdle: boolean
  idleSince?: number
  lastWakeAt?: number
  idleThresholdMs?: number
  wakeCooldownMs?: number
}) {
  const idleThresholdMs = input.idleThresholdMs ?? WATCHDOG_IDLE_THRESHOLD_MS
  const wakeCooldownMs = input.wakeCooldownMs ?? WATCHDOG_WAKE_COOLDOWN_MS
  if (!input.allIdle) {
    return { action: "reset" as const, nextIdleSince: undefined, nextLastWakeAt: input.lastWakeAt }
  }
  const idleSince = input.idleSince ?? input.now
  const idleDurationMs = input.now - idleSince
  if (idleDurationMs < idleThresholdMs) {
    return {
      action: "wait" as const,
      nextIdleSince: idleSince,
      nextLastWakeAt: input.lastWakeAt,
      idleDurationMs,
    }
  }
  if (input.lastWakeAt && input.now - input.lastWakeAt < wakeCooldownMs) {
    return {
      action: "cooldown" as const,
      nextIdleSince: idleSince,
      nextLastWakeAt: input.lastWakeAt,
      idleDurationMs,
    }
  }
  return {
    action: "wake" as const,
    nextIdleSince: idleSince,
    nextLastWakeAt: input.now,
    idleDurationMs,
  }
}

/** Per-node idle gate (execution watchdog). */
export function watchdogNodeIdleTickDecision(input: {
  now: number
  sessionIdle: boolean
  nodeState?: NodeWatchState
  idleThresholdMs?: number
  wakeCooldownMs?: number
}) {
  const idleThresholdMs = input.idleThresholdMs ?? WATCHDOG_IDLE_THRESHOLD_MS
  const wakeCooldownMs = input.wakeCooldownMs ?? WATCHDOG_WAKE_COOLDOWN_MS
  if (!input.sessionIdle) {
    return { action: "reset" as const, nextNodeState: {} as NodeWatchState }
  }
  const idleSince = input.nodeState?.idleSince ?? input.now
  const idleDurationMs = input.now - idleSince
  if (idleDurationMs < idleThresholdMs) {
    return {
      action: "wait" as const,
      nextNodeState: { idleSince } satisfies NodeWatchState,
      idleDurationMs,
    }
  }
  if (input.nodeState?.lastWakeAt && input.now - input.nodeState.lastWakeAt < wakeCooldownMs) {
    return {
      action: "cooldown" as const,
      nextNodeState: { idleSince, lastWakeAt: input.nodeState.lastWakeAt } satisfies NodeWatchState,
      idleDurationMs,
    }
  }
  return {
    action: "wake" as const,
    nextNodeState: { idleSince, lastWakeAt: input.now } satisfies NodeWatchState,
    idleDurationMs,
  }
}
