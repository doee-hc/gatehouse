import type { Database } from "bun:sqlite"
import type { RegistryMissionRecord } from "./types.ts"

export const MISSIONS_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS registry_mission (
      mission_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      objective TEXT,
      done_when_json TEXT NOT NULL,
      must_not_json TEXT NOT NULL,
      contract_raw_json TEXT,
      notes TEXT,
      user_topology TEXT,
      user_skill TEXT,
      started_at TEXT,
      completed_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      locked_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS registry_mission_active_idx ON registry_mission(is_active) WHERE is_active = 1;
`

type MissionRow = {
  mission_id: string
  status: string
  objective: string | null
  done_when_json: string
  must_not_json: string
  contract_raw_json: string | null
  notes: string | null
  user_topology: string | null
  user_skill: string | null
  started_at: string | null
  completed_at: string | null
  is_active: number
  locked_at: string
  updated_at: string
}

function rowToMission(row: MissionRow): RegistryMissionRecord {
  return {
    missionId: row.mission_id,
    status: row.status,
    doneWhen: JSON.parse(row.done_when_json) as string[],
    mustNot: JSON.parse(row.must_not_json) as string[],
    isActive: row.is_active === 1,
    lockedAt: row.locked_at,
    updatedAt: row.updated_at,
    ...(row.objective && { objective: row.objective }),
    ...(row.notes && { notes: row.notes }),
    ...(row.user_topology && { userTopology: row.user_topology }),
    ...(row.user_skill && { userSkill: row.user_skill }),
    ...(row.started_at && { startedAt: row.started_at }),
    ...(row.completed_at && { completedAt: row.completed_at }),
    ...(row.contract_raw_json && { contractRawJson: JSON.parse(row.contract_raw_json) as unknown }),
  }
}

export function getActiveMission(db: Database) {
  const row = db
    .query("SELECT * FROM registry_mission WHERE is_active = 1 LIMIT 1")
    .get() as MissionRow | undefined
  return row ? rowToMission(row) : undefined
}

export function getMission(db: Database, missionId: string) {
  const row = db
    .query("SELECT * FROM registry_mission WHERE mission_id = $mission_id")
    .get({ $mission_id: missionId }) as MissionRow | undefined
  return row ? rowToMission(row) : undefined
}

export function activateMission(db: Database, record: RegistryMissionRecord) {
  db.exec("BEGIN")
  try {
    db.run("UPDATE registry_mission SET is_active = 0 WHERE is_active = 1")
    const upsert = db.prepare(
      `INSERT INTO registry_mission (
          mission_id, status, objective, done_when_json, must_not_json, contract_raw_json, notes,
          user_topology, user_skill, started_at, completed_at, is_active, locked_at, updated_at
        ) VALUES (
          $mission_id, $status, $objective, $done_when_json, $must_not_json, $contract_raw_json, $notes,
          $user_topology, $user_skill, $started_at, $completed_at, 1, $locked_at, $updated_at
        )
        ON CONFLICT(mission_id) DO UPDATE SET
          status = excluded.status,
          objective = excluded.objective,
          done_when_json = excluded.done_when_json,
          must_not_json = excluded.must_not_json,
          contract_raw_json = COALESCE(excluded.contract_raw_json, registry_mission.contract_raw_json),
          notes = excluded.notes,
          user_topology = excluded.user_topology,
          user_skill = excluded.user_skill,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at,
          is_active = 1,
          locked_at = excluded.locked_at,
          updated_at = excluded.updated_at`,
    )
    upsert.run({
      $mission_id: record.missionId,
      $status: record.status,
      $objective: record.objective ?? null,
      $done_when_json: JSON.stringify(record.doneWhen),
      $must_not_json: JSON.stringify(record.mustNot),
      $contract_raw_json:
        record.contractRawJson !== undefined ? JSON.stringify(record.contractRawJson) : null,
      $notes: record.notes ?? null,
      $user_topology: record.userTopology ?? null,
      $user_skill: record.userSkill ?? null,
      $started_at: record.startedAt ?? null,
      $completed_at: record.completedAt ?? null,
      $locked_at: record.lockedAt,
      $updated_at: record.updatedAt,
    })
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

export function updateMissionStatus(db: Database, missionId: string, status: string, completedAt?: string) {
  const updatedAt = new Date().toISOString()
  db.prepare(
    `UPDATE registry_mission SET status = $status, updated_at = $updated_at,
        completed_at = COALESCE($completed_at, completed_at)
       WHERE mission_id = $mission_id`,
  ).run({
    $mission_id: missionId,
    $status: status,
    $updated_at: updatedAt,
    $completed_at: completedAt ?? null,
  })
}

export function deactivateMission(db: Database, missionId: string) {
  db.prepare(
    "UPDATE registry_mission SET is_active = 0, updated_at = $updated_at WHERE mission_id = $mission_id",
  ).run({ $mission_id: missionId, $updated_at: new Date().toISOString() })
}
