import type { PluginInput } from "@opencode-ai/plugin"
import type { RegistryStore } from "../registry/store.ts"
import type { RegistryAgent } from "../registry/types.ts"
import { innerAgentId, retroAgentId } from "../registry/types.ts"
import { sessionStatusById, type SessionRuntimeStatus } from "../session/status.ts"
import { allSessionsIdle, watchdogTickDecision } from "./execution-tree.ts"
import {
  EXECUTION_TREE_IDLE_THRESHOLD_MS,
  EXECUTION_TREE_WATCHDOG_POLL_MS,
  EXECUTION_TREE_WATCHDOG_WAKE_COOLDOWN_MS,
  loadWatchdogRetroRecordWakePrompt,
  loadWatchdogSkillRecordWakePrompt,
} from "./prompt.ts"
import { deleteMissionWatchState, getMissionWatchState, setMissionWatchState, type WatchdogKind } from "./state-store.ts"

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

export async function checkRecordWatchdogMission(input: {
  pluginInput: PluginInput
  registry: RegistryStore
  run: IncompleteRecordRun
  kind: WatchdogKind
  statusMap: Map<string, SessionRuntimeStatus>
  now: number
  resolveAgent: (missionId: string, nodeId: string) => RegistryAgent | undefined
  loadWakePrompt: (
    projectDirectory: string,
    params: { missionId: string; nodeId: string; idleSeconds: number },
  ) => Promise<string>
}) {
  const { pluginInput, registry, run, kind, statusMap, now, resolveAgent, loadWakePrompt } = input
  const { directory } = pluginInput
  const { missionId } = run

  if (run.pendingNodeIds.length === 0) {
    deleteMissionWatchState(directory, missionId, kind)
    return { action: "complete" as const }
  }

  const sessionIds = expectedSessionIds(registry, run, resolveAgent)
  if (sessionIds.length === 0) return { action: "skip" as const }

  const allIdle = allSessionsIdle(statusMap, sessionIds)
  const state = getMissionWatchState(directory, missionId, kind) ?? {}
  const decision = watchdogTickDecision({ now, allIdle, state })
  setMissionWatchState(directory, missionId, decision.nextState, kind)
  if (decision.action !== "wake") return { action: decision.action }

  const idleSeconds = Math.round((decision.idleDurationMs ?? EXECUTION_TREE_IDLE_THRESHOLD_MS) / 1000)
  let anyFailed = false
  for (const nodeId of run.pendingNodeIds) {
    const agent = resolveAgent(missionId, nodeId)
    if (!agent) continue
    const content = await loadWakePrompt(directory, { missionId, nodeId, idleSeconds })
    const delivered = await registry.deliverSystemMessage(agent, content, agent.profile)
    if (delivered.status === "failed") anyFailed = true
  }

  if (anyFailed) {
    const current = getMissionWatchState(directory, missionId, kind) ?? decision.nextState
    setMissionWatchState(directory, missionId, { ...current, lastWakeAt: undefined }, kind)
  }

  return { action: "wake" as const, notified: run.pendingNodeIds.length }
}

class RecordWatchdog {
  private tickTail: Promise<void> = Promise.resolve()

  constructor(
    private input: PluginInput,
    private registry: RegistryStore,
    private kind: WatchdogKind,
    private listRuns: (registry: RegistryStore) => IncompleteRecordRun[],
    private resolveAgent: (registry: RegistryStore, missionId: string, nodeId: string) => RegistryAgent | undefined,
    private loadWakePrompt: (
      projectDirectory: string,
      params: { missionId: string; nodeId: string; idleSeconds: number },
    ) => Promise<string>,
  ) {}

  start(pollMs = EXECUTION_TREE_WATCHDOG_POLL_MS) {
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
      () => undefined,
    )
    return run
  }

  private async tickOnce() {
    const now = Date.now()
    const statusMap = await sessionStatusById(this.input.client, this.input.directory, this.input)
    for (const run of this.listRuns(this.registry)) {
      await checkRecordWatchdogMission({
        pluginInput: this.input,
        registry: this.registry,
        run,
        kind: this.kind,
        statusMap,
        now,
        resolveAgent: (missionId, nodeId) => this.resolveAgent(this.registry, missionId, nodeId),
        loadWakePrompt: this.loadWakePrompt,
      })
    }
  }
}

const stopByDirectory = new Map<string, () => void>()

export function startRecordWatchdogs(input: PluginInput, registry: RegistryStore) {
  stopByDirectory.get(input.directory)?.()

  const stopRetro = new RecordWatchdog(
    input,
    registry,
    "retro_record",
    (store) => store.listIncompleteRetroRecordRuns(),
    (store, missionId, nodeId) => store.byAgentId(retroAgentId(missionId, nodeId)),
    loadWatchdogRetroRecordWakePrompt,
  ).start()

  const stopSkill = new RecordWatchdog(
    input,
    registry,
    "skill_record",
    (store) => store.listIncompleteSkillExtractRecordRuns(),
    (store, missionId, nodeId) => store.byAgentId(innerAgentId(missionId, nodeId)),
    loadWatchdogSkillRecordWakePrompt,
  ).start()

  const stop = () => {
    stopRetro()
    stopSkill()
  }
  stopByDirectory.set(input.directory, stop)
  return stop
}
