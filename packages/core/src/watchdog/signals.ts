import { isInnerStructuralRoot, type RegistryAgent } from "../registry/types.ts"

export type MissionWatchState = {
  allIdleSince?: number
  lastWakeAt?: number
  /** 执行树已向 lead send_message，等待答复期间不触发看门狗 */
  paused?: boolean
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

export function isInnerNotifyingLead(sender: RegistryAgent, recipient: RegistryAgent, missionId: string) {
  if (!isInnerStructuralRoot(sender)) return false
  if (recipient.scope !== "outer" || recipient.profile !== "lead") return false
  if (sender.missionId !== undefined && sender.missionId !== missionId) return false
  return true
}

export function isSendToTreeMember(recipient: RegistryAgent, missionId: string) {
  if (recipient.scope !== "inner") return false
  if (recipient.missionId !== undefined && recipient.missionId !== missionId) return false
  return true
}

export function mergeWatchdogTickState(prev: MissionWatchState, tick: MissionWatchState): MissionWatchState {
  if (prev.paused) return { paused: true }
  return tick
}

export function watchdogSendMessageState(
  state: MissionWatchState,
  input: { missionId?: string; sender: RegistryAgent; recipient: RegistryAgent },
): MissionWatchState {
  const pauseMissionId = input.sender.missionId ?? input.missionId ?? input.recipient.missionId
  const eventMissionId = watchdogMissionId(input)
  if (pauseMissionId && isInnerNotifyingLead(input.sender, input.recipient, pauseMissionId)) {
    return { paused: true }
  }
  if (eventMissionId && isSendToTreeMember(input.recipient, eventMissionId)) {
    return {}
  }
  return state
}
