import { mkdirSync } from "node:fs"
import path from "node:path"
import { Database } from "bun:sqlite"
import { DEFAULT_AGENT_ID } from "../constants.ts"
import { gatehouseRoot } from "../supervisor/config.ts"

const REGISTRY_SCHEMA_VERSION = 8

function configureSqlite(db: Database) {
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;")
}

function schemaReady(db: Database) {
  const row = db.query("PRAGMA user_version").get() as { user_version: number } | undefined
  return row?.user_version === REGISTRY_SCHEMA_VERSION
}

function applyRegistrySchema(db: Database) {
  configureSqlite(db)
  if (schemaReady(db)) return
  db.exec(`
    PRAGMA user_version = ${REGISTRY_SCHEMA_VERSION};

    CREATE TABLE IF NOT EXISTS registry_agent (
      agent_id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      profile TEXT NOT NULL,
      session_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      mission_id TEXT,
      node_id TEXT,
      parent_session_id TEXT,
      project_terminal_session_id TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS registry_agent_session_idx ON registry_agent(session_id);
    CREATE INDEX IF NOT EXISTS registry_agent_scope_profile_idx ON registry_agent(scope, profile);
    CREATE INDEX IF NOT EXISTS registry_agent_mission_idx ON registry_agent(mission_id);
  `)
}

function nowIso() {
  return new Date().toISOString()
}

export function upsertLeadRegistryAgent(
  projectDir: string,
  input: { sessionId: string; displayName: string; createdAt?: string },
) {
  const dir = gatehouseRoot(projectDir)
  mkdirSync(dir, { recursive: true })
  const dbPath = path.join(dir, "registry.db")
  const db = new Database(dbPath)
  try {
    applyRegistrySchema(db)
    const timestamp = nowIso()
    const existing = db
      .query("SELECT created_at FROM registry_agent WHERE agent_id = ? LIMIT 1")
      .get(DEFAULT_AGENT_ID) as { created_at: string } | null
    const createdAt = input.createdAt ?? existing?.created_at ?? timestamp
    db
      .query(
        `INSERT INTO registry_agent (
          agent_id, scope, profile, session_id, display_name,
          mission_id, node_id, parent_session_id, project_terminal_session_id,
          status, created_at, updated_at
        ) VALUES (?, 'outer', 'lead', ?, ?, NULL, NULL, NULL, ?, 'active', ?, ?)
        ON CONFLICT(agent_id) DO UPDATE SET
          session_id = excluded.session_id,
          display_name = excluded.display_name,
          project_terminal_session_id = excluded.project_terminal_session_id,
          status = 'active',
          updated_at = excluded.updated_at`,
      )
      .run(DEFAULT_AGENT_ID, input.sessionId, input.displayName, input.sessionId, createdAt, timestamp)
  } finally {
    db.close()
  }
}
