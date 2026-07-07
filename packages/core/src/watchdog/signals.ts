import { isTerminalInnerAgent } from "../orchestration/plan/graph.ts"
import type { RegistryAgent } from "../registry/types.ts"

export type NodeWatchState = {
  idleSince?: number
  lastWakeAt?: number
}

export type OrchestratorStallWatchState = {
  lastNotifiedAt?: number
  lastAutoResumeAt?: number
}

export type MissionWatchState = {
  /** Per-node idle tracking for execution watchdog. */
  nodes?: Record<string, NodeWatchState>
  /** Mission-level idle tracking for record watchdogs. */
  allIdleSince?: number
  lastWakeAt?: number
  /** 执行团队 terminal 已向 lead 发送交付通知，等待答复期间不触发看门狗 */
  paused?: boolean
  /** Orchestrator stall detection cooldown / auto-resume tracking. */
  orchestratorStall?: OrchestratorStallWatchState
}

export function watchdogMissionId(
  input: { missionId?: string; sender: RegistryAgent; recipient: RegistryAgent },
) {
  return input.missionId ?? input.sender.missionId ?? input.recipient.missionId
}

/** 写入 states Map 时用的 mission_id（优先 sender 所属 Mission，避免 tool 参数与 registry 不一致） */
export function watchdogStateMissionId(
  input: { missionId?: string; sender: RegistryAgent; recipient: RegistryAgent },
) {
  return input.sender.missionId ?? input.missionId ?? input.recipient.missionId
}

export function isInnerNotifyingLead(
  sender: RegistryAgent,
  recipient: RegistryAgent,
  missionId: string,
  projectDirectory: string,
) {
  if (!isTerminalInnerAgent(projectDirectory, sender)) return false
  if (recipient.scope !== "outer" || recipient.profile !== "lead") return false
  if (sender.missionId !== undefined && sender.missionId !== missionId) return false
  return true
}

export function isSendToMissionMember(recipient: RegistryAgent, missionId: string) {
  if (recipient.scope !== "inner") return false
  if (recipient.missionId !== undefined && recipient.missionId !== missionId) return false
  return true
}

export function mergeWatchdogTickState(prev: MissionWatchState, tick: MissionWatchState): MissionWatchState {
  if (prev.paused) return { paused: true }
  return tick
}

export function watchdogDeliveryEventState(
  state: MissionWatchState,
  kind: "submitted" | "revision_requested",
): MissionWatchState {
  if (kind === "revision_requested") return {}
  if (kind === "submitted") return { paused: true }
  return state
}

export function watchdogSendMessageState(
  state: MissionWatchState,
  input: {
    missionId?: string
    sender: RegistryAgent
    recipient: RegistryAgent
    projectDirectory: string
  },
): MissionWatchState {
  const pauseMissionId = input.sender.missionId ?? input.missionId ?? input.recipient.missionId
  const eventMissionId = watchdogMissionId(input)
  if (
    pauseMissionId &&
    isInnerNotifyingLead(input.sender, input.recipient, pauseMissionId, input.projectDirectory)
  ) {
    return { paused: true }
  }
  if (eventMissionId && isSendToMissionMember(input.recipient, eventMissionId)) {
    return {}
  }
  return state
}
