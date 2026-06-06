import type { RegistryStore } from "../registry/store.ts"
import type { RegistryAgent } from "../registry/types.ts"

export function activeMissionId(store: RegistryStore) {
  return store.getActiveMission()?.missionId
}

export function requireActiveMissionId(store: RegistryStore) {
  const missionId = activeMissionId(store)
  if (!missionId) {
    throw new Error("No active mission in registry; call gatehouse_mission_start first")
  }
  return missionId
}

export function requireSenderMissionId(sender: RegistryAgent | undefined) {
  if (!sender?.missionId) {
    throw new Error("Caller session is not associated with a mission in registry")
  }
  return sender.missionId
}

export function resolveRecipientMissionId(store: RegistryStore, sender: RegistryAgent | undefined) {
  return sender?.missionId ?? activeMissionId(store)
}
