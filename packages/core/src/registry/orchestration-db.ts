import type { Database } from "bun:sqlite"
import type { OrchestrationState } from "../orchestration/types.ts"
import type { MissionScriptMeta, MissionScriptRecord } from "../orchestration/types.ts"
import type { TeamSpec } from "../tree/types.ts"

export const ORCHESTRATION_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS registry_mission_script (
      mission_id TEXT PRIMARY KEY,
      team_json TEXT NOT NULL,
      meta_json TEXT,
      script_path TEXT,
      script_hash TEXT,
      locked_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS registry_orchestration_state (
      mission_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      phase TEXT,
      updated_at TEXT NOT NULL
    );
`

export function migrateOrchestrationTables(db: Database) {
  db.exec(ORCHESTRATION_TABLE_SQL)
  const columns = db
    .query("PRAGMA table_info(registry_mission_script)")
    .all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === "script_hash")) {
    db.exec("ALTER TABLE registry_mission_script ADD COLUMN script_hash TEXT")
  }
}

export function saveMissionScript(
  db: Database,
  input: {
    missionId: string
    team: TeamSpec
    meta?: MissionScriptMeta
    scriptPath?: string
    scriptHash?: string
  },
) {
  const lockedAt = new Date().toISOString()
  db.prepare(
    `INSERT INTO registry_mission_script (mission_id, team_json, meta_json, script_path, script_hash, locked_at)
     VALUES ($mission_id, $team_json, $meta_json, $script_path, $script_hash, $locked_at)
     ON CONFLICT(mission_id) DO UPDATE SET
       team_json = excluded.team_json,
       meta_json = excluded.meta_json,
       script_path = excluded.script_path,
       script_hash = excluded.script_hash,
       locked_at = excluded.locked_at`,
  ).run({
    $mission_id: input.missionId,
    $team_json: JSON.stringify(input.team),
    $meta_json: input.meta ? JSON.stringify(input.meta) : null,
    $script_path: input.scriptPath ?? null,
    $script_hash: input.scriptHash ?? null,
    $locked_at: lockedAt,
  })
}

export function readMissionScript(db: Database, missionId: string): MissionScriptRecord | undefined {
  const row = db
    .query(
      "SELECT mission_id, team_json, meta_json, script_path, script_hash, locked_at FROM registry_mission_script WHERE mission_id = $mission_id",
    )
    .get({ $mission_id: missionId }) as
    | {
        mission_id: string
        team_json: string
        meta_json: string | null
        script_path: string | null
        script_hash: string | null
        locked_at: string
      }
    | undefined
  if (!row) return undefined
  return {
    missionId: row.mission_id,
    team: JSON.parse(row.team_json) as TeamSpec,
    ...(row.meta_json && { meta: JSON.parse(row.meta_json) as MissionScriptMeta }),
    ...(row.script_path && { scriptPath: row.script_path }),
    ...(row.script_hash && { scriptHash: row.script_hash }),
    lockedAt: row.locked_at,
  }
}

export function saveOrchestrationState(db: Database, state: OrchestrationState) {
  state.updated_at = new Date().toISOString()
  db.prepare(
    `INSERT INTO registry_orchestration_state (mission_id, state_json, phase, updated_at)
     VALUES ($mission_id, $state_json, $phase, $updated_at)
     ON CONFLICT(mission_id) DO UPDATE SET
       state_json = excluded.state_json,
       phase = excluded.phase,
       updated_at = excluded.updated_at`,
  ).run({
    $mission_id: state.mission_id,
    $state_json: JSON.stringify(state),
    $phase: state.phase ?? null,
    $updated_at: state.updated_at,
  })
}

export function readOrchestrationState(db: Database, missionId: string): OrchestrationState | undefined {
  const row = db
    .query("SELECT state_json FROM registry_orchestration_state WHERE mission_id = $mission_id")
    .get({ $mission_id: missionId }) as { state_json: string } | undefined
  if (!row) return undefined
  return JSON.parse(row.state_json) as OrchestrationState
}
