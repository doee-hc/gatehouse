import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { DEFAULT_AGENT_ID } from "../../src/channels/constants.ts"
import { ensureLeadAgentTarget } from "../../src/channels/registry/lead-session.ts"
import { readRegistryAgentById } from "../../src/channels/registry/agent-target.ts"
import type { OpencodeClient } from "../../src/channels/opencode/client.ts"
import type { ChannelBridgeConfig } from "../../src/channels/types.ts"

function writeRegistryLead(dir: string, sessionId: string) {
  const gatehouse = path.join(dir, ".gatehouse")
  mkdirSync(gatehouse, { recursive: true })
  const dbPath = path.join(gatehouse, "registry.db")
  if (existsSync(dbPath)) unlinkSync(dbPath)
  const db = new Database(dbPath)
  db.exec(`
    PRAGMA user_version = 7;
    CREATE TABLE registry_agent (
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
  `)
  db
    .query(
      `INSERT INTO registry_agent (
      agent_id, scope, profile, session_id, display_name,
      project_terminal_session_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      DEFAULT_AGENT_ID,
      "outer",
      "lead",
      sessionId,
      "Lead",
      sessionId,
      "active",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    )
  db.close()
}

function mockClient(input: {
  existingSessions?: Set<string>
  onCreate?: (body: unknown) => void
  onPrompt?: (body: unknown) => void
}) {
  const sessions = new Set(input.existingSessions ?? [])
  const client = {
    session: {
      async create(req: { body?: unknown }) {
        input.onCreate?.(req.body)
        const id = "ses_new_lead"
        sessions.add(id)
        return { data: { id } }
      },
      async get(req: { path: { id: string } }) {
        if (sessions.has(req.path.id)) return { data: { id: req.path.id } }
        return { error: "not found" }
      },
      async promptAsync(req: { body?: unknown }) {
        input.onPrompt?.(req.body)
      },
      async update() {},
    },
  }
  return client as unknown as OpencodeClient
}

function bridgeConfig(projectDir: string): ChannelBridgeConfig {
  return {
    projectDir,
    opencodeUrl: "http://127.0.0.1:4096",
    leadReplyTimeoutMs: 60_000,
    stateDir: path.join(projectDir, ".gatehouse/channels/test"),
  }
}

describe("ensureLeadAgentTarget", () => {
  test("returns existing lead when registry and OpenCode session are valid", async () => {
    const dir = path.join(import.meta.dir, `.tmp-ensure-lead-existing-${crypto.randomUUID()}`)
    mkdirSync(dir, { recursive: true })
    writeRegistryLead(dir, "ses_existing")
    const client = mockClient({ existingSessions: new Set(["ses_existing"]) })

    const target = await ensureLeadAgentTarget(client, bridgeConfig(dir))
    expect(target.sessionId).toBe("ses_existing")
    expect(target.agentId).toBe(DEFAULT_AGENT_ID)
  })

  test("creates lead session and registers it when missing", async () => {
    const dir = path.join(import.meta.dir, `.tmp-ensure-lead-create-${crypto.randomUUID()}`)
    mkdirSync(path.join(dir, ".gatehouse"), { recursive: true })
    writeFileSync(path.join(dir, ".gatehouse/.keep"), "")
    let createBody: unknown
    const client = mockClient({
      onCreate: (body) => {
        createBody = body
      },
    })

    const target = await ensureLeadAgentTarget(client, bridgeConfig(dir))
    expect(target.sessionId).toBe("ses_new_lead")
    expect(target.opencodeAgent).toBe("lead")
    expect(createBody).toEqual({ title: "Lead", agent: "lead" })

    const registered = readRegistryAgentById(dir, DEFAULT_AGENT_ID)
    expect(registered?.sessionId).toBe("ses_new_lead")
    expect(registered?.displayName).toBe("Lead")
  })

  test("recreates lead when registry entry points to missing OpenCode session", async () => {
    const dir = path.join(import.meta.dir, `.tmp-ensure-lead-stale-${crypto.randomUUID()}`)
    mkdirSync(dir, { recursive: true })
    writeRegistryLead(dir, "ses_stale")
    const client = mockClient({ existingSessions: new Set() })

    const target = await ensureLeadAgentTarget(client, bridgeConfig(dir))
    expect(target.sessionId).toBe("ses_new_lead")
    expect(readRegistryAgentById(dir, DEFAULT_AGENT_ID)?.sessionId).toBe("ses_new_lead")
  })

  test("uses configured lead display name from gatehouse config", async () => {
    const dir = path.join(import.meta.dir, `.tmp-ensure-lead-name-${crypto.randomUUID()}`)
    mkdirSync(path.join(dir, ".gatehouse"), { recursive: true })
    writeFileSync(
      path.join(dir, ".gatehouse/config.yaml"),
      `agents:\n  lead:\n    name: 项目经理\n`,
    )
    let createBody: unknown
    const client = mockClient({
      onCreate: (body) => {
        createBody = body
      },
    })

    const target = await ensureLeadAgentTarget(client, bridgeConfig(dir))
    expect(target.displayName).toBe("项目经理")
    expect(createBody).toEqual({ title: "项目经理", agent: "lead" })
    expect(readRegistryAgentById(dir, DEFAULT_AGENT_ID)?.displayName).toBe("项目经理")
  })
})
