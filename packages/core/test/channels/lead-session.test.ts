import { mkdirSync, unlinkSync, writeFileSync } from "node:fs"
import { existsSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { readRegistryLeadSessionId } from "../../src/channels/registry/agent-target.ts"

function writeRegistryLead(dir: string, sessionId: string) {
  const gatehouse = path.join(dir, ".gatehouse")
  mkdirSync(gatehouse, { recursive: true })
  const dbPath = path.join(gatehouse, "registry.db")
  if (existsSync(dbPath)) unlinkSync(dbPath)
  const db = new Database(dbPath)
  db.exec(`
    PRAGMA user_version = 7;
    CREATE TABLE IF NOT EXISTS registry_agent (
      agent_id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      profile TEXT NOT NULL,
      session_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      mission_id TEXT,
      node_id TEXT,
      parent_session_id TEXT,
      project_root_session_id TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  db
    .query(
      `INSERT INTO registry_agent (
      agent_id, scope, profile, session_id, display_name,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("outer:lead", "outer", "lead", sessionId, "Lead", "active", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
  db.close()
}

describe("readRegistryLeadSessionId", () => {
  test("returns session id from registry.db", () => {
    const dir = path.join(import.meta.dir, `.tmp-lead-session-${crypto.randomUUID()}`)
    mkdirSync(dir, { recursive: true })
    writeRegistryLead(dir, "ses_lead_abc")
    expect(readRegistryLeadSessionId(dir)).toBe("ses_lead_abc")
  })

  test("returns undefined when registry missing", () => {
    const dir = path.join(import.meta.dir, `.tmp-no-registry-${crypto.randomUUID()}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, ".keep"), "")
    expect(readRegistryLeadSessionId(dir)).toBeUndefined()
  })
})
