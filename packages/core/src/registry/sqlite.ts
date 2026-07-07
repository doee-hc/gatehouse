import type { Database } from "bun:sqlite"
import { REGISTRY_SCHEMA_VERSION } from "./types.ts"

export function configureSqlite(db: Database) {
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;")
}

export function schemaReady(db: Database) {
  const row = db.query("PRAGMA user_version").get() as { user_version: number } | undefined
  return row?.user_version === REGISTRY_SCHEMA_VERSION
}

export function tableColumns(db: Database, table: string) {
  const exists = db
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = $name")
    .get({ $name: table })
  if (!exists) return new Set<string>()
  const columns = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return new Set(columns.map((column) => column.name))
}
