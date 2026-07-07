import type { Database } from "bun:sqlite"
import type { OrchestrationState } from "../orchestration/types.ts"
import type { MissionScriptMeta, MissionScriptRecord } from "../orchestration/types.ts"
import type { OrchestrationPlan } from "../orchestration/plan/types.ts"
import type { OrchestrationBaseline } from "../orchestration/plan/types.ts"
import type { MissionTeamSpec } from "../missions/manifest/types.ts"

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

    CREATE TABLE IF NOT EXISTS registry_orchestration_plan (
      mission_id TEXT NOT NULL,
      plan_version TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (mission_id, plan_version)
    );

    CREATE TABLE IF NOT EXISTS registry_orchestration_baseline (
      baseline_id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      baseline_json TEXT NOT NULL,
      created_at TEXT NOT NULL
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
    team: MissionTeamSpec
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
    team: JSON.parse(row.team_json) as MissionTeamSpec,
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

export function saveOrchestrationPlan(db: Database, plan: OrchestrationPlan) {
  const createdAt = new Date().toISOString()
  db.prepare(
    `INSERT INTO registry_orchestration_plan (mission_id, plan_version, plan_json, created_at)
     VALUES ($mission_id, $plan_version, $plan_json, $created_at)
     ON CONFLICT(mission_id, plan_version) DO UPDATE SET
       plan_json = excluded.plan_json,
       created_at = excluded.created_at`,
  ).run({
    $mission_id: plan.mission_id,
    $plan_version: plan.plan_version,
    $plan_json: JSON.stringify(plan),
    $created_at: createdAt,
  })
}

export function readOrchestrationPlan(
  db: Database,
  missionId: string,
  planVersion: string,
): OrchestrationPlan | undefined {
  const row = db
    .query(
      "SELECT plan_json FROM registry_orchestration_plan WHERE mission_id = $mission_id AND plan_version = $plan_version",
    )
    .get({ $mission_id: missionId, $plan_version: planVersion }) as { plan_json: string } | undefined
  if (!row) return undefined
  return JSON.parse(row.plan_json) as OrchestrationPlan
}

export function readLatestOrchestrationPlan(db: Database, missionId: string): OrchestrationPlan | undefined {
  const row = db
    .query(
      `SELECT plan_json FROM registry_orchestration_plan
       WHERE mission_id = $mission_id
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get({ $mission_id: missionId }) as { plan_json: string } | undefined
  if (!row) return undefined
  return JSON.parse(row.plan_json) as OrchestrationPlan
}

export function saveOrchestrationBaseline(db: Database, baseline: OrchestrationBaseline) {
  db.prepare(
    `INSERT INTO registry_orchestration_baseline (baseline_id, mission_id, baseline_json, created_at)
     VALUES ($baseline_id, $mission_id, $baseline_json, $created_at)
     ON CONFLICT(baseline_id) DO UPDATE SET
       baseline_json = excluded.baseline_json`,
  ).run({
    $baseline_id: baseline.baseline_id,
    $mission_id: baseline.mission_id,
    $baseline_json: JSON.stringify(baseline),
    $created_at: baseline.captured_at,
  })
}

export function readOrchestrationBaseline(db: Database, baselineId: string): OrchestrationBaseline | undefined {
  const row = db
    .query("SELECT baseline_json FROM registry_orchestration_baseline WHERE baseline_id = $baseline_id")
    .get({ $baseline_id: baselineId }) as { baseline_json: string } | undefined
  if (!row) return undefined
  return JSON.parse(row.baseline_json) as OrchestrationBaseline
}

/** Atomic read-modify-write for concurrent node completions. */
export function mutateOrchestrationState(
  db: Database,
  missionId: string,
  mutator: (state: OrchestrationState) => void,
): OrchestrationState | undefined {
  db.exec("BEGIN IMMEDIATE")
  try {
    const state = readOrchestrationState(db, missionId)
    if (!state) {
      db.exec("ROLLBACK")
      return undefined
    }
    mutator(state)
    saveOrchestrationState(db, state)
    db.exec("COMMIT")
    return state
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}
