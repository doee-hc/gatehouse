import type { PluginInput } from "@opencode-ai/plugin"
import type { RegistryStore } from "../registry/store.ts"
import type { RegistryAgent } from "../registry/types.ts"
import { innerAgentId } from "../registry/types.ts"
import { sessionRuntimeStatus, sessionStatusById, type SessionRuntimeStatus } from "../session/status.ts"
import { readManifest, readRetroManifest } from "../tree/store.ts"
import type { TreeManifest } from "../tree/types.ts"
import { registerWatchdogSendHandler } from "./notify.ts"
import {
  EXECUTION_TREE_IDLE_THRESHOLD_MS,
  EXECUTION_TREE_WATCHDOG_POLL_MS,
  EXECUTION_TREE_WATCHDOG_WAKE_COOLDOWN_MS,
  listRunningMissionIds,
  loadWatchdogRootWakePrompt,
} from "./prompt.ts"
import {
  mergeWatchdogTickState,
  type MissionWatchState,
  watchdogSendMessageState,
  watchdogStateMissionId,
} from "./signals.ts"
import {
  deleteMissionWatchState,
  getMissionWatchState,
  setMissionWatchState,
} from "./state-store.ts"

export function manifestSessionIds(manifest: TreeManifest) {
  return Object.values(manifest.nodes).map((node) => node.session_id)
}

export function allSessionsIdle(statusMap: Map<string, SessionRuntimeStatus>, sessionIds: string[]) {
  if (sessionIds.length === 0) return false
  return sessionIds.every((sessionId) => sessionRuntimeStatus(statusMap, sessionId) === "idle")
}

export function watchdogTickDecision(input: {
  now: number
  allIdle: boolean
  state: MissionWatchState
  idleThresholdMs?: number
  wakeCooldownMs?: number
}) {
  const idleThresholdMs = input.idleThresholdMs ?? EXECUTION_TREE_IDLE_THRESHOLD_MS
  const wakeCooldownMs = input.wakeCooldownMs ?? EXECUTION_TREE_WATCHDOG_WAKE_COOLDOWN_MS
  if (!input.allIdle) {
    return {
      action: "reset" as const,
      nextState: mergeWatchdogTickState(input.state, {}),
    }
  }
  const allIdleSince = input.state.allIdleSince ?? input.now
  const idleDurationMs = input.now - allIdleSince
  if (idleDurationMs < idleThresholdMs) {
    return {
      action: "wait" as const,
      nextState: mergeWatchdogTickState(input.state, { ...input.state, allIdleSince }),
      idleDurationMs,
    }
  }
  if (input.state.lastWakeAt && input.now - input.state.lastWakeAt < wakeCooldownMs) {
    return {
      action: "cooldown" as const,
      nextState: mergeWatchdogTickState(input.state, { ...input.state, allIdleSince }),
      idleDurationMs,
    }
  }
  return {
    action: "wake" as const,
    nextState: mergeWatchdogTickState(input.state, { lastWakeAt: input.now }),
    idleDurationMs,
  }
}

const stopByDirectory = new Map<string, () => void>()

export class ExecutionTreeWatchdog {
  private tickTail: Promise<void> = Promise.resolve()

  constructor(
    private input: PluginInput,
    private registry: RegistryStore,
  ) {}

  start(pollMs = EXECUTION_TREE_WATCHDOG_POLL_MS) {
    const unregisterSend = registerWatchdogSendHandler(this.input.directory, (event) => {
      this.recordSendMessage(event)
    })
    const interval = setInterval(() => {
      void this.tick()
    }, pollMs)
    interval.unref?.()
    return () => {
      clearInterval(interval)
      unregisterSend()
    }
  }

  recordSendMessage(event: { missionId?: string; sender: RegistryAgent; recipient: RegistryAgent }) {
    const missionId = watchdogStateMissionId(event)
    if (!missionId) return
    const state = getMissionWatchState(this.input.directory, missionId) ?? {}
    setMissionWatchState(this.input.directory, missionId, watchdogSendMessageState(state, event))
  }

  tick() {
    const run = this.tickTail.then(() => this.tickOnce())
    this.tickTail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async tickOnce() {
    const now = Date.now()
    const statusMap = await sessionStatusById(this.input.client, this.input.directory, this.input)
    for (const missionId of await listRunningMissionIds(this.input.directory)) {
      await this.checkMission(missionId, statusMap, now)
    }
  }

  private async checkMission(
    missionId: string,
    statusMap: Map<string, SessionRuntimeStatus>,
    now: number,
  ) {
    const manifest = await readManifest(this.input.directory, missionId)
    if (!manifest || manifest.status !== "running") {
      deleteMissionWatchState(this.input.directory, missionId)
      return
    }
    if (await readRetroManifest(this.input.directory, missionId)) {
      deleteMissionWatchState(this.input.directory, missionId)
      return
    }

    const state = getMissionWatchState(this.input.directory, missionId) ?? {}
    if (state.paused) return

    const sessionIds = manifestSessionIds(manifest)
    const allIdle = allSessionsIdle(statusMap, sessionIds)
    const decision = watchdogTickDecision({ now, allIdle, state })
    if (getMissionWatchState(this.input.directory, missionId)?.paused) return
    setMissionWatchState(this.input.directory, missionId, decision.nextState)
    if (decision.action !== "wake") return
    if (getMissionWatchState(this.input.directory, missionId)?.paused) return

    const root = this.registry.byAgentId(innerAgentId(manifest.mission_id, manifest.root_node))
    if (!root) return

    const idleSeconds = Math.round((decision.idleDurationMs ?? EXECUTION_TREE_IDLE_THRESHOLD_MS) / 1000)
    const content = await loadWatchdogRootWakePrompt(
      this.input.directory,
      manifest.mission_id,
      idleSeconds,
      manifest,
    )
    if (getMissionWatchState(this.input.directory, missionId)?.paused) return
    const delivered = await this.registry.deliverSystemMessage(root, content, root.profile)
    if (delivered.status === "failed") {
      const current = getMissionWatchState(this.input.directory, missionId) ?? decision.nextState
      setMissionWatchState(this.input.directory, missionId, { ...current, lastWakeAt: undefined })
    }
  }
}

export function startExecutionTreeWatchdog(input: PluginInput, registry: RegistryStore) {
  stopByDirectory.get(input.directory)?.()
  const stop = new ExecutionTreeWatchdog(input, registry).start()
  stopByDirectory.set(input.directory, stop)
  return stop
}
