import type { Database } from "bun:sqlite"
import { REGISTRY_MISSION_RETRO_TABLE_SQL } from "./mission-manifest-schema.ts"
import { tableColumns } from "./sqlite.ts"

export const SKILL_PIPELINE_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS registry_retro_run (
      mission_id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      retro_summary_submitted_at TEXT,
      retro_summary_path TEXT,
      architect_notified_at TEXT,
      architect_lead_notified_at TEXT,
      lead_retro_summary_notified_at TEXT
    );

    CREATE TABLE IF NOT EXISTS registry_skill_extract_run (
      mission_id TEXT PRIMARY KEY,
      expected_node_ids TEXT NOT NULL,
      started_at TEXT NOT NULL,
      verify_started_at TEXT,
      curator_notified_at TEXT,
      curator_lead_notified_at TEXT
    );

    CREATE TABLE IF NOT EXISTS registry_skill_extract_completion (
      mission_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      summary_path TEXT,
      session_id TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      PRIMARY KEY (mission_id, node_id)
    );

    CREATE TABLE IF NOT EXISTS registry_skill_verify_run (
      mission_id TEXT PRIMARY KEY,
      expected_node_ids TEXT NOT NULL,
      started_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS registry_skill_verify_completion (
      mission_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      passed INTEGER NOT NULL,
      report_path TEXT,
      PRIMARY KEY (mission_id, node_id)
    );
`

export function migrateRetroAnalystSchema(db: Database) {
  db.exec(REGISTRY_MISSION_RETRO_TABLE_SQL)
}

export function migrateRetroLeadNotifiedColumns(db: Database) {
  const retroCols = tableColumns(db, "registry_retro_run")
  if (retroCols.size > 0 && !retroCols.has("architect_lead_notified_at")) {
    db.exec("ALTER TABLE registry_retro_run ADD COLUMN architect_lead_notified_at TEXT")
  }
  if (retroCols.size > 0 && !retroCols.has("lead_retro_summary_notified_at")) {
    db.exec("ALTER TABLE registry_retro_run ADD COLUMN lead_retro_summary_notified_at TEXT")
  }
  const skillCols = tableColumns(db, "registry_skill_extract_run")
  if (skillCols.size > 0 && !skillCols.has("curator_lead_notified_at")) {
    db.exec("ALTER TABLE registry_skill_extract_run ADD COLUMN curator_lead_notified_at TEXT")
  }
  if (skillCols.size > 0 && !skillCols.has("verify_started_at")) {
    db.exec("ALTER TABLE registry_skill_extract_run ADD COLUMN verify_started_at TEXT")
  }
}

export function migrateSkillPipelineTables(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS registry_skill_verify_run (
      mission_id TEXT PRIMARY KEY,
      expected_node_ids TEXT NOT NULL,
      started_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS registry_skill_verify_completion (
      mission_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      passed INTEGER NOT NULL,
      report_path TEXT,
      PRIMARY KEY (mission_id, node_id)
    );
  `)
}
