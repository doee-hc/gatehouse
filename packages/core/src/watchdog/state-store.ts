import type { RegistryDatabase } from "../registry/db.ts"
import { deleteWatchdogState, saveWatchdogState } from "./state-db.ts"
import type { MissionWatchState } from "./signals.ts"
import type { WatchdogKind } from "./state-db.ts"

export type { WatchdogKind } from "./state-db.ts"

const statesByKey = new Map<string, MissionWatchState>()
const dbByDirectory = new Map<string, RegistryDatabase>()

function watchKey(directory: string, missionId: string, kind: WatchdogKind = "execution") {
  return `${directory}\0${kind}\0${missionId}`
}

export function bindWatchdogStateStore(directory: string, db: RegistryDatabase) {
  dbByDirectory.set(directory, db)
  for (const row of db.loadWatchdogStates()) {
    statesByKey.set(watchKey(directory, row.missionId, row.kind), row.state)
  }
}

function persistState(
  directory: string,
  missionId: string,
  kind: WatchdogKind,
  state: MissionWatchState | null,
) {
  const db = dbByDirectory.get(directory)
  if (!db) return
  if (state === null || Object.keys(state).length === 0) {
    db.deleteWatchdogState(missionId, kind)
    return
  }
  db.saveWatchdogState(missionId, kind, state)
}

export function getMissionWatchState(directory: string, missionId: string, kind: WatchdogKind = "execution") {
  return statesByKey.get(watchKey(directory, missionId, kind))
}

export function setMissionWatchState(
  directory: string,
  missionId: string,
  state: MissionWatchState,
  kind: WatchdogKind = "execution",
) {
  if (Object.keys(state).length === 0) {
    statesByKey.delete(watchKey(directory, missionId, kind))
    persistState(directory, missionId, kind, null)
    return
  }
  statesByKey.set(watchKey(directory, missionId, kind), state)
  persistState(directory, missionId, kind, state)
}

export function deleteMissionWatchState(directory: string, missionId: string, kind: WatchdogKind = "execution") {
  statesByKey.delete(watchKey(directory, missionId, kind))
  persistState(directory, missionId, kind, null)
}

/** @internal test helper */
export function resetWatchdogStateStoreForTests() {
  statesByKey.clear()
  dbByDirectory.clear()
}
