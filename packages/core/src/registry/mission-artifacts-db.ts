import type { Database } from "bun:sqlite"
import type { NodeBrief } from "../execution/types.ts"
import { isRecord, parseYaml } from "../yaml.ts"

export const MISSION_ARTIFACTS_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS registry_node_brief (
      mission_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      brief_json TEXT NOT NULL,
      locked_at TEXT NOT NULL,
      PRIMARY KEY (mission_id, node_id)
    );
`

function tableColumns(db: Database, table: string) {
  const exists = db
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = $name")
    .get({ $name: table })
  if (!exists) return new Set<string>()
  const columns = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return new Set(columns.map((column) => column.name))
}

export function migrateMissionArtifactsTables(db: Database) {
  db.exec(MISSION_ARTIFACTS_TABLE_SQL)
  const missionCols = tableColumns(db, "registry_mission")
  if (missionCols.size > 0 && !missionCols.has("contract_raw_json")) {
    db.exec("ALTER TABLE registry_mission ADD COLUMN contract_raw_json TEXT")
  }
  if (missionCols.size > 0 && !missionCols.has("user_topology")) {
    db.exec("ALTER TABLE registry_mission ADD COLUMN user_topology TEXT")
  }
  if (missionCols.size > 0 && !missionCols.has("user_skill")) {
    db.exec("ALTER TABLE registry_mission ADD COLUMN user_skill TEXT")
  }
}

export function saveMissionContractRaw(db: Database, missionId: string, contractRaw: unknown) {
  const updatedAt = new Date().toISOString()
  db.prepare(
    `UPDATE registry_mission SET contract_raw_json = $contract_raw_json, updated_at = $updated_at
     WHERE mission_id = $mission_id`,
  ).run({
    $mission_id: missionId,
    $contract_raw_json: JSON.stringify(contractRaw),
    $updated_at: updatedAt,
  })
}

export function readMissionContractRaw(db: Database, missionId: string): unknown | undefined {
  const row = db
    .query("SELECT contract_raw_json FROM registry_mission WHERE mission_id = $mission_id")
    .get({ $mission_id: missionId }) as { contract_raw_json: string | null } | undefined
  if (!row?.contract_raw_json) return undefined
  return JSON.parse(row.contract_raw_json) as unknown
}

export function saveNodeBrief(db: Database, missionId: string, nodeId: string, brief: NodeBrief) {
  const lockedAt = new Date().toISOString()
  db.prepare(
    `INSERT INTO registry_node_brief (mission_id, node_id, brief_json, locked_at)
     VALUES ($mission_id, $node_id, $brief_json, $locked_at)
     ON CONFLICT(mission_id, node_id) DO UPDATE SET
       brief_json = excluded.brief_json,
       locked_at = excluded.locked_at`,
  ).run({
    $mission_id: missionId,
    $node_id: nodeId,
    $brief_json: JSON.stringify(brief),
    $locked_at: lockedAt,
  })
}

export function readNodeBrief(db: Database, missionId: string, nodeId: string): NodeBrief | undefined {
  const row = db
    .query(
      "SELECT brief_json FROM registry_node_brief WHERE mission_id = $mission_id AND node_id = $node_id",
    )
    .get({ $mission_id: missionId, $node_id: nodeId }) as { brief_json: string } | undefined
  if (!row) return undefined
  return JSON.parse(row.brief_json) as NodeBrief
}

export function listNodeBriefIds(db: Database, missionId: string) {
  return db
    .query("SELECT node_id FROM registry_node_brief WHERE mission_id = $mission_id ORDER BY node_id")
    .all({ $mission_id: missionId })
    .map((row) => (row as { node_id: string }).node_id)
}

export function parseMissionRawDoneWhenFromContractRaw(contractRaw: unknown) {
  if (!isRecord(contractRaw)) return undefined
  return Array.isArray(contractRaw.done_when) ? contractRaw.done_when : undefined
}

export function parseContractRawFromYamlExport(text: string) {
  const raw = parseYaml(text)
  if (!isRecord(raw)) return undefined
  if (isRecord(raw.mission)) return raw.mission
  return raw
}
