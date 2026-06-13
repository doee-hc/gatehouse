import type { Database } from "bun:sqlite"
import type { DeliveryDocument } from "./types.ts"
import { DELIVERY_SCHEMA_VERSION } from "./types.ts"

export const DELIVERY_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS registry_delivery (
      mission_id TEXT PRIMARY KEY,
      document_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
`

export function migrateDeliveryTable(db: Database) {
  db.exec(DELIVERY_TABLE_SQL)
}

export function readDeliveryDocumentFromDb(db: Database, missionId: string): DeliveryDocument | undefined {
  const row = db
    .query("SELECT document_json FROM registry_delivery WHERE mission_id = $mission_id")
    .get({ $mission_id: missionId }) as { document_json: string } | undefined
  if (!row?.document_json) return undefined
  return JSON.parse(row.document_json) as DeliveryDocument
}

export function writeDeliveryDocumentToDb(db: Database, doc: DeliveryDocument) {
  const updatedAt = new Date().toISOString()
  db.prepare(
    `INSERT INTO registry_delivery (mission_id, document_json, updated_at)
     VALUES ($mission_id, $document_json, $updated_at)
     ON CONFLICT(mission_id) DO UPDATE SET
       document_json = excluded.document_json,
       updated_at = excluded.updated_at`,
  ).run({
    $mission_id: doc.mission_id,
    $document_json: JSON.stringify(doc),
    $updated_at: updatedAt,
  })
}

export function emptyDeliveryDocument(missionId: string): DeliveryDocument {
  return {
    schema_version: DELIVERY_SCHEMA_VERSION,
    mission_id: missionId,
    history: [],
  }
}
