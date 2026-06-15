import type { PluginInput } from "@opencode-ai/plugin"
import { gatehouseLog } from "../log.ts"
import { readLocaleSync } from "../locale.ts"
import type { ResolvedOrchestrationStallWatchdogTiming } from "../gatehouse-config.ts"
import type { RegistryStore } from "../registry/store.ts"
import type { OrchestrationState } from "../orchestration/types.ts"
import { detectOrchestrationStall, type OrchestrationStall } from "../orchestration/stall.ts"
import { resumeOrchestrationForActiveMission } from "../orchestration/resume.ts"
import { isSandboxRunning } from "../orchestration/sandbox-runtime.ts"
import { loadWatchdogOrchestratorStallPrompt } from "./prompt.ts"
import type { MissionWatchState, OrchestratorStallWatchState } from "./signals.ts"

export const ORCHESTRATION_STALL_NOTIFY_COOLDOWN_MS = 5 * 60_000
export const ORCHESTRATION_STALL_RESUME_COOLDOWN_MS = 60_000

function stallKindLabel(locale: ReturnType<typeof readLocaleSync>, stall: OrchestrationStall) {
  if (stall.kind === "sandbox_dead") {
    return locale === "zh" ? "已停止" : "not running"
  }
  return locale === "zh" ? "仍在运行但未推进 phase" : "running but phase has not advanced"
}

export async function checkOrchestrationStallWatchdog(input: {
  pluginInput: PluginInput
  registry: RegistryStore
  missionId: string
  orchState: OrchestrationState
  missionWatchState: MissionWatchState
  now: number
  timing?: ResolvedOrchestrationStallWatchdogTiming
}) {
  const timing = input.timing
  const stall = detectOrchestrationStall({
    state: input.orchState,
    sandboxRunning: isSandboxRunning(input.missionId),
    now: input.now,
    stallThresholdMs: timing?.stall_threshold_ms,
  })
  if (!stall) {
    return { action: "idle" as const }
  }

  const prev: OrchestratorStallWatchState = input.missionWatchState.orchestratorStall ?? {}

  if (stall.kind === "sandbox_dead") {
    const resumeCooldownMs = timing?.resume_cooldown_ms ?? ORCHESTRATION_STALL_RESUME_COOLDOWN_MS
    const lastResume = prev.lastAutoResumeAt ?? 0
    if (input.now - lastResume >= resumeCooldownMs) {
      const resumed = await resumeOrchestrationForActiveMission(
        input.pluginInput,
        input.registry,
        input.missionId,
      )
      if (resumed.status === "resumed") {
        gatehouseLog("info", `[orchestration:${input.missionId}] auto-resumed sandbox after stall detection`)
        return {
          action: "resumed" as const,
          orchestratorStall: { ...prev, lastAutoResumeAt: input.now },
        }
      }
    }
  }

  const notifyCooldownMs = timing?.notify_cooldown_ms ?? ORCHESTRATION_STALL_NOTIFY_COOLDOWN_MS
  const lastNotify = prev.lastNotifiedAt ?? 0
  if (input.now - lastNotify < notifyCooldownMs) {
    return { action: "cooldown" as const }
  }

  const locale = readLocaleSync(input.pluginInput.directory)
  const staleMinutes = Math.max(1, Math.round(stall.staleMs / 60_000))
  const content = await loadWatchdogOrchestratorStallPrompt(input.pluginInput.directory, {
    missionId: input.missionId,
    phase: stall.phase ?? "—",
    staleMinutes,
    stallKindLabel: stallKindLabel(locale, stall),
  })
  const architect = input.registry.byProfile("architect", "outer")
  if (!architect) {
    return { action: "skipped" as const, reason: "no architect session" }
  }
  const delivered = await input.registry.deliverSystemMessage(architect, content, architect.profile)
  await input.registry.flushPendingDeliveries()
  if (delivered.status === "failed") {
    return { action: "failed" as const }
  }

  gatehouseLog(
    "warn",
    `[orchestration:${input.missionId}] orchestrator stall (${stall.kind}, stale ${staleMinutes}m) — notified architect`,
  )
  return {
    action: "notified" as const,
    orchestratorStall: { ...prev, lastNotifiedAt: input.now },
  }
}
