import type { PluginInput } from "@opencode-ai/plugin"
import type { RegistryStore } from "../registry/store.ts"
import { LEAD_OPENCODE } from "../registry/types.ts"
import { gatehouseLog } from "../log.ts"
import type { ResolvedWatchdogPollTiming } from "../gatehouse-config.ts"
import { sessionRuntimeStatus, sessionStatusById } from "../session/status.ts"
import { readDirectionDocument, directionIsConfirmed } from "../lead/direction.ts"
import { readAutopilotDocument, autopilotIsEnabled } from "../lead/autopilot.ts"
import { maybeDeliverAutopilotEnabledNotice } from "../lead/autopilot-notify.ts"
import { activePortalMissionIds } from "../missions/parse.ts"
import { readMissionsDocument } from "../missions/store.ts"
import {
  clearAutopilotWatchState,
  readAutopilotWatchState,
  writeAutopilotWatchState,
  type AutopilotWatchState,
} from "../lead/autopilot-watch.ts"
import { leadLastConversationMessage } from "../lead/session-messages.ts"
import { loadAutopilotWakePrompt } from "./prompt.ts"
import { WATCHDOG_WAKE_COOLDOWN_MS } from "./tick.ts"

export const AUTOPILOT_WAKE_THRESHOLD_MS = 3 * 60 * 1000
export const AUTOPILOT_WAKE_POLL_MS = 30_000

function logAutopilotTickError(directory: string, error: unknown) {
  gatehouseLog(
    "error",
    `autopilot watchdog tick failed: ${error instanceof Error ? error.message : String(error)}`,
    { projectDirectory: directory, title: "Watchdog" },
  )
}

export async function checkAutopilotWatchdog(input: {
  pluginInput: PluginInput
  registry: RegistryStore
  now: number
  timing?: ResolvedWatchdogPollTiming
}) {
  const { pluginInput, registry, now, timing } = input
  const idleThresholdMs = timing?.idle_threshold_ms ?? AUTOPILOT_WAKE_THRESHOLD_MS
  const wakeCooldownMs = timing?.wake_cooldown_ms ?? WATCHDOG_WAKE_COOLDOWN_MS
  const { directory } = pluginInput

  const autopilot = await readAutopilotDocument(directory)
  if (!autopilotIsEnabled(autopilot)) {
    return { action: "autopilot_off" as const }
  }

  const direction = await readDirectionDocument(directory)
  if (!directionIsConfirmed(direction)) {
    return { action: "direction_not_confirmed" as const }
  }

  const enabledNotice = await maybeDeliverAutopilotEnabledNotice({
    projectDirectory: directory,
    registry,
  })
  if (enabledNotice.action === "notified") {
    gatehouseLog("info", "autopilot enabled notice delivered to lead", {
      projectDirectory: directory,
      title: "Autopilot",
    })
  }

  const activeMissionIds = activePortalMissionIds(await readMissionsDocument(directory))
  if (activeMissionIds.length > 0) {
    const state = await readAutopilotWatchState(directory)
    if (state.awaiting_since) {
      await writeAutopilotWatchState(directory, { ...state, awaiting_since: undefined })
    }
    return { action: "mission_active" as const, missionId: activeMissionIds[0]! }
  }

  const lead = registry.byProfile(LEAD_OPENCODE, "outer")
  if (!lead?.sessionId) return { action: "no_lead" as const }

  const statusMap = await sessionStatusById(pluginInput.client, directory, pluginInput)
  if (!statusMap) return { action: "no_status" as const }
  if (sessionRuntimeStatus(statusMap, lead.sessionId) !== "idle") {
    return { action: "lead_busy" as const }
  }

  const last = await leadLastConversationMessage(pluginInput, lead.sessionId)
  if (!last || last.role !== "assistant") {
    const state = await readAutopilotWatchState(directory)
    const next: AutopilotWatchState = {
      ...state,
      awaiting_since: undefined,
      last_assistant_message_id: last?.id,
    }
    await writeAutopilotWatchState(directory, next)
    return { action: "wait_assistant" as const }
  }

  const state = await readAutopilotWatchState(directory)
  let awaitingSince = state.awaiting_since
  if (state.last_assistant_message_id !== last.id || !awaitingSince) {
    awaitingSince = now
  }

  const idleDurationMs = now - awaitingSince
  if (idleDurationMs < idleThresholdMs) {
    await writeAutopilotWatchState(directory, {
      ...state,
      awaiting_since: awaitingSince,
      last_assistant_message_id: last.id,
    })
    return { action: "wait" as const, idleDurationMs }
  }

  if (state.last_wake_at && now - state.last_wake_at < wakeCooldownMs) {
    return { action: "cooldown" as const, idleDurationMs }
  }

  const content = await loadAutopilotWakePrompt(directory)

  const delivered = await registry.deliverSystemMessage(lead, content, lead.profile)
  if (delivered.status === "failed") {
    return { action: "wake_failed" as const }
  }

  await writeAutopilotWatchState(directory, {
    ...state,
    awaiting_since: awaitingSince,
    last_assistant_message_id: last.id,
    last_wake_at: now,
  })

  return { action: "wake" as const, idleDurationMs }
}

const stopByDirectory = new Map<string, () => void>()

export class AutopilotWatchdog {
  private tickTail: Promise<void> = Promise.resolve()

  constructor(
    private input: PluginInput,
    private registry: RegistryStore,
    private timing: ResolvedWatchdogPollTiming,
  ) {}

  start(pollMs = this.timing.poll_ms) {
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
      (error) => logAutopilotTickError(this.input.directory, error),
    )
    return run
  }

  private async tickOnce() {
    await checkAutopilotWatchdog({
      pluginInput: this.input,
      registry: this.registry,
      now: Date.now(),
      timing: this.timing,
    })
  }
}

export function startAutopilotWatchdog(
  input: PluginInput,
  registry: RegistryStore,
  timing: ResolvedWatchdogPollTiming,
) {
  stopByDirectory.get(input.directory)?.()
  const stop = new AutopilotWatchdog(input, registry, timing).start()
  stopByDirectory.set(input.directory, stop)
  return stop
}

export { clearAutopilotWatchState } from "../lead/autopilot-watch.ts"
