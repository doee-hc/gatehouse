import type { PluginInput } from "@opencode-ai/plugin"
import type { RegistryStore } from "../registry/store.ts"
import type { RegistryAgent } from "../registry/types.ts"
import { innerAgentId } from "../registry/types.ts"
import { gatehouseLog } from "../log.ts"
import { sessionRuntimeStatus, sessionStatusById, type SessionRuntimeStatus } from "../session/status.ts"
import { orchestrationProblemNodeIds, readOrchestrationState } from "../orchestration/state.ts"
import type { OrchestrationState } from "../orchestration/types.ts"
import { readManifest, readRetroManifest } from "../tree/store.ts"
import type { TreeManifest } from "../tree/types.ts"
import { registerWatchdogDeliveryHandler, registerWatchdogSendHandler } from "./notify.ts"
import {
  loadWatchdogNodeWakePrompt,
  listRunningMissionIds,
  WATCHDOG_IDLE_THRESHOLD_MS,
  WATCHDOG_POLL_MS,
} from "./prompt.ts"
import {
  mergeWatchdogTickState,
  type MissionWatchState,
  type NodeWatchState,
  watchdogDeliveryEventState,
  watchdogSendMessageState,
  watchdogStateMissionId,
} from "./signals.ts"
import {
  deleteMissionWatchState,
  getMissionWatchState,
  pruneWatchdogStates,
  setMissionWatchState,
} from "./state-store.ts"
import { watchdogNodeIdleTickDecision } from "./tick.ts"

function logWatchdogTickError(directory: string, label: string, error: unknown) {
  gatehouseLog(
    "error",
    `${label} tick failed: ${error instanceof Error ? error.message : String(error)}`,
    { projectDirectory: directory, title: "Watchdog" },
  )
}

export function allSessionsIdle(statusMap: Map<string, SessionRuntimeStatus>, sessionIds: string[]) {
  if (sessionIds.length === 0) return false
  return sessionIds.every((sessionId) => sessionRuntimeStatus(statusMap, sessionId) === "idle")
}

function mergeNodeWatchState(
  prev: MissionWatchState,
  nodeUpdates: Record<string, NodeWatchState | null>,
): MissionWatchState {
  if (prev.paused) return { paused: true }
  const nodes = { ...prev.nodes }
  for (const [nodeId, state] of Object.entries(nodeUpdates)) {
    if (state === null || Object.keys(state).length === 0) delete nodes[nodeId]
    else nodes[nodeId] = state
  }
  if (Object.keys(nodes).length === 0) return {}
  return { nodes }
}

export async function checkExecutionWatchdogMission(input: {
  pluginInput: PluginInput
  registry: RegistryStore
  missionId: string
  manifest: TreeManifest
  orchState: OrchestrationState
  statusMap: Map<string, SessionRuntimeStatus>
  now: number
  loadWakePrompt?: (
    projectDirectory: string,
    params: { missionId: string; nodeId: string; idleSeconds: number; rootNodeId: string },
  ) => Promise<string>
}) {
  const {
    pluginInput,
    registry,
    missionId,
    manifest,
    orchState,
    statusMap,
    now,
    loadWakePrompt = loadWatchdogNodeWakePrompt,
  } = input
  const { directory } = pluginInput

  const missionState = getMissionWatchState(directory, missionId) ?? {}
  if (missionState.paused) return { action: "paused" as const }

  const problemIds = orchestrationProblemNodeIds(orchState)
  if (problemIds.length === 0) {
    if (missionState.nodes && Object.keys(missionState.nodes).length > 0) {
      setMissionWatchState(directory, missionId, mergeWatchdogTickState(missionState, {}))
    }
    return { action: "idle" as const }
  }

  const nodeUpdates: Record<string, NodeWatchState | null> = {}
  const wakes: string[] = []
  let notified = 0

  for (const trackedId of Object.keys(missionState.nodes ?? {})) {
    if (!problemIds.includes(trackedId)) nodeUpdates[trackedId] = null
  }

  for (const nodeId of problemIds) {
    const sessionId = manifest.nodes[nodeId]?.session_id
    if (!sessionId) continue
    const sessionIdle = sessionRuntimeStatus(statusMap, sessionId) === "idle"
    const prevNode = missionState.nodes?.[nodeId]
    const decision = watchdogNodeIdleTickDecision({ now, sessionIdle, nodeState: prevNode })

    if (decision.action === "wake") {
      if (getMissionWatchState(directory, missionId)?.paused) return { action: "paused" as const }
      const agent = registry.byAgentId(innerAgentId(missionId, nodeId))
      if (!agent) {
        nodeUpdates[nodeId] = decision.nextNodeState
        continue
      }
      const idleSeconds = Math.round((decision.idleDurationMs ?? WATCHDOG_IDLE_THRESHOLD_MS) / 1000)
      const content = await loadWakePrompt(directory, {
        missionId,
        nodeId,
        idleSeconds,
        rootNodeId: manifest.root_node,
      })
      if (getMissionWatchState(directory, missionId)?.paused) return { action: "paused" as const }
      const delivered = await registry.deliverSystemMessage(agent, content, agent.profile)
      if (delivered.status === "failed") continue
      nodeUpdates[nodeId] = decision.nextNodeState
      wakes.push(nodeId)
      notified += 1
      continue
    }

    nodeUpdates[nodeId] = decision.nextNodeState
  }

  if (Object.keys(nodeUpdates).length > 0) {
    setMissionWatchState(directory, missionId, mergeNodeWatchState(missionState, nodeUpdates))
  }

  if (wakes.length > 0) return { action: "wake" as const, notified, wakes }
  return { action: "wait" as const }
}

const stopByDirectory = new Map<string, () => void>()

export class ExecutionTreeWatchdog {
  private tickTail: Promise<void> = Promise.resolve()

  constructor(
    private input: PluginInput,
    private registry: RegistryStore,
  ) {}

  start(pollMs = WATCHDOG_POLL_MS) {
    const unregisterSend = registerWatchdogSendHandler(this.input.directory, (event) => {
      this.recordSendMessage(event)
    })
    const unregisterDelivery = registerWatchdogDeliveryHandler(this.input.directory, (event) => {
      this.recordDeliveryEvent(event)
    })
    const interval = setInterval(() => {
      void this.tick()
    }, pollMs)
    interval.unref?.()
    return () => {
      clearInterval(interval)
      unregisterSend()
      unregisterDelivery()
    }
  }

  recordDeliveryEvent(event: { missionId: string; kind: "submitted" | "revision_requested" }) {
    const state = getMissionWatchState(this.input.directory, event.missionId) ?? {}
    setMissionWatchState(
      this.input.directory,
      event.missionId,
      watchdogDeliveryEventState(state, event.kind),
    )
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
      (error) => logWatchdogTickError(this.input.directory, "execution watchdog", error),
    )
    return run
  }

  private async tickOnce() {
    const now = Date.now()
    const statusMap = await sessionStatusById(this.input.client, this.input.directory, this.input)
    if (!statusMap) return

    const runningMissionIds = await listRunningMissionIds(this.input.directory)
    for (const missionId of runningMissionIds) {
      await this.checkMission(missionId, statusMap, now)
    }
    pruneWatchdogStates(this.input.directory, "execution", runningMissionIds)
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

    const orchState = readOrchestrationState(this.input.directory, missionId)
    if (!orchState) {
      deleteMissionWatchState(this.input.directory, missionId)
      return
    }

    await checkExecutionWatchdogMission({
      pluginInput: this.input,
      registry: this.registry,
      missionId,
      manifest,
      orchState,
      statusMap,
      now,
    })
  }
}

export function startExecutionTreeWatchdog(input: PluginInput, registry: RegistryStore) {
  stopByDirectory.get(input.directory)?.()
  const stop = new ExecutionTreeWatchdog(input, registry).start()
  stopByDirectory.set(input.directory, stop)
  return stop
}
