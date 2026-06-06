import type { Database } from "bun:sqlite"
import type { MissionWatchState } from "./signals.ts"

export type WatchdogKind = "execution" | "retro_record" | "skill_record"

export const WATCHDOG_STATE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS registry_watchdog_state (
      mission_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      paused INTEGER NOT NULL DEFAULT 0,
      all_idle_since INTEGER,
      last_wake_at INTEGER,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (mission_id, kind)
    );
`

type WatchdogStateRow = {
  mission_id: string
  kind: string
  paused: number
  all_idle_since: number | null
  last_wake_at: number | null
  updated_at: string
}

function rowToWatchState(row: WatchdogStateRow) {
  const state: MissionWatchState = {}
  if (row.paused === 1) state.paused = true
  if (row.all_idle_since != null) state.allIdleSince = row.all_idle_since
  if (row.last_wake_at != null) state.lastWakeAt = row.last_wake_at
  return {
    missionId: row.mission_id,
    kind: row.kind as WatchdogKind,
    state,
  }
}

export function migrateWatchdogStateTable(db: Database) {
  const exists = db
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'registry_watchdog_state'")
    .get()
  if (!exists) db.exec(WATCHDOG_STATE_TABLE_SQL)
}

export function loadAllWatchdogStates(db: Database) {
  return db
    .query("SELECT * FROM registry_watchdog_state ORDER BY mission_id, kind")
    .all()
    .map((row) => rowToWatchState(row as WatchdogStateRow))
}

export function saveWatchdogState(db: Database, missionId: string, kind: WatchdogKind, state: MissionWatchState) {
  db.prepare(
    `INSERT INTO registry_watchdog_state (
      mission_id, kind, paused, all_idle_since, last_wake_at, updated_at
    ) VALUES (
      $mission_id, $kind, $paused, $all_idle_since, $last_wake_at, $updated_at
    )
    ON CONFLICT(mission_id, kind) DO UPDATE SET
      paused = excluded.paused,
      all_idle_since = excluded.all_idle_since,
      last_wake_at = excluded.last_wake_at,
      updated_at = excluded.updated_at`,
  ).run({
    $mission_id: missionId,
    $kind: kind,
    $paused: state.paused ? 1 : 0,
    $all_idle_since: state.allIdleSince ?? null,
    $last_wake_at: state.lastWakeAt ?? null,
    $updated_at: new Date().toISOString(),
  })
}

export function deleteWatchdogState(db: Database, missionId: string, kind: WatchdogKind) {
  db.prepare("DELETE FROM registry_watchdog_state WHERE mission_id = $mission_id AND kind = $kind").run({
    $mission_id: missionId,
    $kind: kind,
  })
}
