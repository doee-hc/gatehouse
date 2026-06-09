import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import {
  getLastContextToken,
  getLastDeliveredAssistantMessageId,
  listUsersBoundToSession,
  rememberContextToken,
  setLastDeliveredAssistantMessageId,
} from "../../src/channels/store/state.ts"

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "channels-relay-"))
  tempDirs.push(dir)
  const gatehouse = path.join(dir, ".gatehouse")
  fs.mkdirSync(gatehouse, { recursive: true })
  const db = new Database(path.join(gatehouse, "registry.db"))
  db.exec(`
    CREATE TABLE registry_agent (
      agent_id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      session_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      profile TEXT NOT NULL,
      mission_id TEXT,
      node_id TEXT,
      status TEXT NOT NULL
    );
  `)
  db.run(
    `INSERT INTO registry_agent (agent_id, scope, session_id, display_name, profile, status)
     VALUES ('outer:lead', 'outer', 'ses_lead', 'Lead', 'lead', 'active')`,
  )
  db.close()
  const stateDir = path.join(gatehouse, "channels", "weixin")
  fs.mkdirSync(stateDir, { recursive: true })
  return { projectDir: dir, stateDir }
}

describe("session relay state", () => {
  test("tracks context token and per-session delivery watermark", () => {
    const { stateDir } = tempProject()
    rememberContextToken(stateDir, "wx-user", "ctx-1")
    setLastDeliveredAssistantMessageId(stateDir, "wx-user", "ses_lead", "msg-9")
    expect(getLastContextToken(stateDir, "wx-user")).toBe("ctx-1")
    expect(getLastDeliveredAssistantMessageId(stateDir, "wx-user", "ses_lead")).toBe("msg-9")
  })

  test("lists users bound to a session via activeAgentId", () => {
    const { projectDir, stateDir } = tempProject()
    fs.writeFileSync(
      path.join(stateDir, "sessions.json"),
      JSON.stringify({
        "wx-a": { activeAgentId: "outer:lead" },
        "wx-b": { activeAgentId: "outer:lead" },
        "wx-c": { activeAgentId: "outer:architect" },
      }),
    )
    expect(listUsersBoundToSession(stateDir, projectDir, "ses_lead").sort()).toEqual(["wx-a", "wx-b"])
  })
})
