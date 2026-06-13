import type { PluginInput } from "@opencode-ai/plugin"
import type { RegistryStore } from "../registry/store.ts"
import { LEAD_OPENCODE } from "../registry/types.ts"
import { gatehouseLog } from "../log.ts"
import { sessionRuntimeStatus, sessionStatusById } from "../session/status.ts"
import { readDirectionDocument, directionIsConfirmed } from "../lead/direction.ts"
import {
  clearLeadAwaitUserState,
  readLeadAwaitUserState,
  writeLeadAwaitUserState,
  type LeadAwaitUserState,
} from "../lead/await-user-state.ts"
import { leadLastConversationMessage } from "../lead/session-messages.ts"
import { resolveLeadAwaitContext, leadAwaitContextMatchesState } from "../lead/await-phase.ts"
import { loadWatchdogLeadUserBusyWakePrompt } from "./prompt.ts"
import { WATCHDOG_WAKE_COOLDOWN_MS } from "./tick.ts"

export const LEAD_USER_AWAIT_THRESHOLD_MS = 10 * 60 * 1000
export const LEAD_USER_AWAIT_POLL_MS = 30_000

function logLeadAwaitTickError(directory: string, error: unknown) {
  gatehouseLog(
    "error",
    `lead user-await watchdog tick failed: ${error instanceof Error ? error.message : String(error)}`,
    { projectDirectory: directory, title: "Watchdog" },
  )
}

export async function checkLeadUserAwaitWatchdog(input: {
  pluginInput: PluginInput
  registry: RegistryStore
  now: number
  idleThresholdMs?: number
  wakeCooldownMs?: number
}) {
  const { pluginInput, registry, now } = input
  const idleThresholdMs = input.idleThresholdMs ?? LEAD_USER_AWAIT_THRESHOLD_MS
  const wakeCooldownMs = input.wakeCooldownMs ?? WATCHDOG_WAKE_COOLDOWN_MS
  const { directory } = pluginInput

  const lead = registry.byProfile(LEAD_OPENCODE, "outer")
  if (!lead?.sessionId) return { action: "no_lead" as const }

  const state = await readLeadAwaitUserState(directory)
  const ctx = await resolveLeadAwaitContext({
    projectDirectory: directory,
    registry,
    armedPreStartMissionId: state.phase === "pre_start" && state.armed ? state.mission_id : undefined,
  })

  if (!ctx) {
    if (Object.keys(state).length > 0) await clearLeadAwaitUserState(directory)
    return { action: "idle" as const }
  }

  if (!leadAwaitContextMatchesState(ctx, state)) {
    await writeLeadAwaitUserState(directory, {
      phase: ctx.phase,
      mission_id: ctx.missionId,
      ...(ctx.requiresArm ? { armed: state.armed } : {}),
    })
    return { action: "resync" as const, phase: ctx.phase }
  }

  const statusMap = await sessionStatusById(pluginInput.client, directory, pluginInput)
  if (!statusMap) return { action: "no_status" as const }
  if (sessionRuntimeStatus(statusMap, lead.sessionId) !== "idle") {
    return { action: "lead_busy" as const }
  }

  const last = await leadLastConversationMessage(pluginInput, lead.sessionId)
  if (!last || last.role !== "assistant") {
    const next: LeadAwaitUserState = {
      ...state,
      phase: ctx.phase,
      mission_id: ctx.missionId,
      awaiting_since: undefined,
      last_assistant_message_id: last?.id,
    }
    await writeLeadAwaitUserState(directory, next)
    return { action: "wait_assistant" as const }
  }

  let awaitingSince = state.awaiting_since
  if (state.last_assistant_message_id !== last.id || !awaitingSince) {
    awaitingSince = now
  }

  const idleDurationMs = now - awaitingSince
  if (idleDurationMs < idleThresholdMs) {
    await writeLeadAwaitUserState(directory, {
      ...state,
      phase: ctx.phase,
      mission_id: ctx.missionId,
      awaiting_since: awaitingSince,
      last_assistant_message_id: last.id,
    })
    return { action: "wait" as const, idleDurationMs }
  }

  if (state.last_wake_at && now - state.last_wake_at < wakeCooldownMs) {
    return { action: "cooldown" as const, idleDurationMs }
  }

  const direction = await readDirectionDocument(directory)
  const content = await loadWatchdogLeadUserBusyWakePrompt(directory, {
    phase: ctx.phase,
    missionId: ctx.missionId,
    idleMinutes: Math.round(idleDurationMs / 60_000),
    directionConfirmed: directionIsConfirmed(direction),
  })

  const delivered = await registry.deliverSystemMessage(lead, content, lead.profile)
  if (delivered.status === "failed") {
    return { action: "wake_failed" as const }
  }

  await writeLeadAwaitUserState(directory, {
    ...state,
    phase: ctx.phase,
    mission_id: ctx.missionId,
    awaiting_since: awaitingSince,
    last_assistant_message_id: last.id,
    last_wake_at: now,
  })

  return { action: "wake" as const, phase: ctx.phase, missionId: ctx.missionId }
}

const stopByDirectory = new Map<string, () => void>()

export class LeadUserAwaitWatchdog {
  private tickTail: Promise<void> = Promise.resolve()

  constructor(
    private input: PluginInput,
    private registry: RegistryStore,
  ) {}

  start(pollMs = LEAD_USER_AWAIT_POLL_MS) {
    const interval = setInterval(() => {
      void this.tick()
    }, pollMs)
    interval.unref?.()
    return () => clearInterval(interval)
  }

  tick() {
    const run = this.tickTail.then(() => this.tickOnce())
    this.tickTail = run.then(
      () => undefined,
      (error) => logLeadAwaitTickError(this.input.directory, error),
    )
    return run
  }

  private async tickOnce() {
    await checkLeadUserAwaitWatchdog({
      pluginInput: this.input,
      registry: this.registry,
      now: Date.now(),
    })
  }
}

export function startLeadUserAwaitWatchdog(input: PluginInput, registry: RegistryStore) {
  stopByDirectory.get(input.directory)?.()
  const stop = new LeadUserAwaitWatchdog(input, registry).start()
  stopByDirectory.set(input.directory, stop)
  return stop
}

export { clearLeadAwaitUserState } from "../lead/await-user-state.ts"

export async function onLeadSessionUserMessage(projectDirectory: string) {
  await clearLeadAwaitUserState(projectDirectory)
}
