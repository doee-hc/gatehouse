import type { PluginInput } from "@opencode-ai/plugin"
import type { RegistryStore } from "../registry/store.ts"
import type { RegistryAgent } from "../registry/types.ts"
import { retroAgentId, extractAgentId, verifyAgentId } from "../registry/types.ts"
import { gatehouseLog } from "../log.ts"
import type { ResolvedWatchdogPollTiming } from "../gatehouse-config.ts"
import { sessionStatusById, type SessionRuntimeStatus } from "../session/status.ts"
import { allSessionsIdle } from "./mission-watchdog.ts"
import {
  loadWatchdogRetroRecordWakePrompt,
  loadWatchdogSkillRecordWakePrompt,
  loadWatchdogSkillVerifyRecordWakePrompt,
  WATCHDOG_IDLE_THRESHOLD_MS,
} from "./prompt.ts"
import { watchdogIdleTickDecision } from "./tick.ts"
import {
  deleteMissionWatchState,
  getMissionWatchState,
  pruneWatchdogStates,
  setMissionWatchState,
  type WatchdogKind,
} from "./state-store.ts"

export type IncompleteRecordRun = {
  missionId: string
  expectedNodeIds: string[]
  pendingNodeIds: string[]
}

export function expectedSessionIds(
  registry: RegistryStore,
  run: IncompleteRecordRun,
  resolveAgent: (missionId: string, nodeId: string) => RegistryAgent | undefined,
) {
  return run.expectedNodeIds.flatMap((nodeId) => {
    const agent = resolveAgent(run.missionId, nodeId)
    return agent?.sessionId ? [agent.sessionId] : []
  })
}

export function pendingSessionIds(
  run: IncompleteRecordRun,
  resolveAgent: (missionId: string, nodeId: string) => RegistryAgent | undefined,
) {
  return run.pendingNodeIds.flatMap((nodeId) => {
    const agent = resolveAgent(run.missionId, nodeId)
    return agent?.sessionId ? [agent.sessionId] : []
  })
}

function resetRecordWatchIdleTiming(directory: string, missionId: string, kind: WatchdogKind) {
  const state = getMissionWatchState(directory, missionId, kind)
  if (!state?.allIdleSince && !state?.lastWakeAt) return
  if (state.paused) return
  setMissionWatchState(directory, missionId, {}, kind)
}

export async function checkRecordWatchdogMission(input: {
  pluginInput: PluginInput
  registry: RegistryStore
  run: IncompleteRecordRun
  kind: WatchdogKind
  statusMap: Map<string, SessionRuntimeStatus>
  now: number
  timing?: ResolvedWatchdogPollTiming
  resolveAgent: (missionId: string, nodeId: string) => RegistryAgent | undefined
  loadWakePrompt: (
    projectDirectory: string,
    params: { missionId: string; nodeId: string; idleSeconds: number },
  ) => Promise<string>
}) {
  const { pluginInput, registry, run, kind, statusMap, now, timing, resolveAgent, loadWakePrompt } = input
  const { directory } = pluginInput
  const { missionId } = run

  if (run.pendingNodeIds.length === 0) {
    deleteMissionWatchState(directory, missionId, kind)
    return { action: "complete" as const }
  }

  const sessionIds = pendingSessionIds(run, resolveAgent)
  if (sessionIds.length === 0) {
    resetRecordWatchIdleTiming(directory, missionId, kind)
    return { action: "skip" as const }
  }

  const allIdle = allSessionsIdle(statusMap, sessionIds)
  const state = getMissionWatchState(directory, missionId, kind) ?? {}
  const decision = watchdogIdleTickDecision({
    now,
    allIdle,
    idleSince: state.allIdleSince,
    lastWakeAt: state.lastWakeAt,
    idleThresholdMs: timing?.idle_threshold_ms,
    wakeCooldownMs: timing?.wake_cooldown_ms,
  })
  const nextMissionState = {
    ...(decision.nextIdleSince !== undefined ? { allIdleSince: decision.nextIdleSince } : {}),
    ...(decision.nextLastWakeAt !== undefined ? { lastWakeAt: decision.nextLastWakeAt } : {}),
  }
  if (decision.action !== "wake") {
    setMissionWatchState(directory, missionId, nextMissionState, kind)
    return { action: decision.action }
  }

  const idleSeconds = Math.round(
    (decision.idleDurationMs ?? timing?.idle_threshold_ms ?? WATCHDOG_IDLE_THRESHOLD_MS) / 1000,
  )
  let deliveredCount = 0
  let anyFailed = false
  for (const nodeId of run.pendingNodeIds) {
    const agent = resolveAgent(missionId, nodeId)
    if (!agent) continue
    const content = await loadWakePrompt(directory, { missionId, nodeId, idleSeconds })
    const delivered = await registry.deliverSystemMessage(agent, content, agent.profile)
    if (delivered.status === "failed") anyFailed = true
    else deliveredCount++
  }

  if (deliveredCount === 0 || anyFailed) {
    return { action: "wake" as const, notified: deliveredCount }
  }

  setMissionWatchState(directory, missionId, nextMissionState, kind)
  return { action: "wake" as const, notified: deliveredCount }
}

function logWatchdogTickError(directory: string, label: string, error: unknown) {
  gatehouseLog(
    "error",
    `${label} tick failed: ${error instanceof Error ? error.message : String(error)}`,
    { projectDirectory: directory, title: "Watchdog" },
  )
}

class RecordWatchdog {
  private tickTail: Promise<void> = Promise.resolve()

  constructor(
    private input: PluginInput,
    private registry: RegistryStore,
    private kind: WatchdogKind,
    private timing: ResolvedWatchdogPollTiming,
    private listRuns: (registry: RegistryStore) => IncompleteRecordRun[],
    private resolveAgent: (registry: RegistryStore, missionId: string, nodeId: string) => RegistryAgent | undefined,
    private loadWakePrompt: (
      projectDirectory: string,
      params: { missionId: string; nodeId: string; idleSeconds: number },
    ) => Promise<string>,
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
      (error) => logWatchdogTickError(this.input.directory, `${this.kind} watchdog`, error),
    )
    return run
  }

  private async tickOnce() {
    const now = Date.now()
    const statusMap = await sessionStatusById(this.input.client, this.input.directory, this.input)
    if (!statusMap) return

    const runs = this.listRuns(this.registry)
    for (const run of runs) {
      await checkRecordWatchdogMission({
        pluginInput: this.input,
        registry: this.registry,
        run,
        kind: this.kind,
        statusMap,
        now,
        timing: this.timing,
        resolveAgent: (missionId, nodeId) => this.resolveAgent(this.registry, missionId, nodeId),
        loadWakePrompt: this.loadWakePrompt,
      })
    }
    pruneWatchdogStates(
      this.input.directory,
      this.kind,
      runs.map((run) => run.missionId),
    )
  }
}

const stopByDirectory = new Map<string, () => void>()

export function startRecordWatchdogs(
  input: PluginInput,
  registry: RegistryStore,
  timing: ResolvedWatchdogPollTiming,
) {
  stopByDirectory.get(input.directory)?.()

  const stopRetro = new RecordWatchdog(
    input,
    registry,
    "retro_record",
    timing,
    (store) => store.listIncompleteRetroRecordRuns(),
    (store, missionId, _nodeId) => store.byAgentId(retroAgentId(missionId)),
    loadWatchdogRetroRecordWakePrompt,
  ).start()

  const stopSkill = new RecordWatchdog(
    input,
    registry,
    "skill_record",
    timing,
    (store) => store.listIncompleteSkillExtractRecordRuns(),
    (store, missionId, nodeId) => store.byAgentId(extractAgentId(missionId, nodeId)),
    loadWatchdogSkillRecordWakePrompt,
  ).start()

  const stopVerify = new RecordWatchdog(
    input,
    registry,
    "skill_verify_record",
    timing,
    (store) => store.listIncompleteSkillVerifyRecordRuns(),
    (store, missionId, nodeId) => store.byAgentId(verifyAgentId(missionId, nodeId)),
    loadWatchdogSkillVerifyRecordWakePrompt,
  ).start()

  const stop = () => {
    stopRetro()
    stopSkill()
    stopVerify()
  }
  stopByDirectory.set(input.directory, stop)
  return stop
}
