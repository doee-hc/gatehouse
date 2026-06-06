import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import {
  formatAgentDirectory,
  formatAgentDirectoryForProject,
  isAgentSwitchable,
  listSwitchableAgents,
  readRegistryAgentById,
} from "../src/registry/agent-target.ts"
import { loadAgentDescriptions } from "../src/registry/agent-descriptions.ts"

function writeRegistry(dir: string, rows: Array<Record<string, string | null>>) {
  const gatehouse = path.join(dir, ".gatehouse")
  mkdirSync(path.join(gatehouse, "lead"), { recursive: true })
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
      project_root_session_id TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  const insert = db.query(
    `INSERT INTO registry_agent (
      agent_id, scope, profile, session_id, display_name,
      mission_id, node_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  )
  for (const row of rows) {
    insert.run(
      row.agent_id,
      row.scope,
      row.profile ?? "build",
      row.session_id,
      row.display_name,
      row.mission_id ?? null,
      row.node_id ?? null,
    )
  }
  db.close()
}

describe("isAgentSwitchable", () => {
  test("outer agents are always switchable", () => {
    const outer = {
      agentId: "outer:lead",
      scope: "outer",
      sessionId: "s1",
      displayName: "Lead",
      opencodeAgent: "lead",
    }
    expect(isAgentSwitchable(outer, undefined)).toBe(true)
    expect(isAgentSwitchable(outer, "m-run")).toBe(true)
  })

  test("inner agents only for current mission", () => {
    const inner = {
      agentId: "inner:m-run:root",
      scope: "inner",
      sessionId: "s2",
      displayName: "root",
      opencodeAgent: "build",
      missionId: "m-run",
    }
    expect(isAgentSwitchable(inner, "m-run")).toBe(true)
    expect(isAgentSwitchable(inner, "m-old")).toBe(false)
    expect(isAgentSwitchable(inner, undefined)).toBe(false)
  })
})

describe("listSwitchableAgents", () => {
  test("hides inner agents from other missions", async () => {
    const dir = path.join(import.meta.dir, `.tmp-agents-${crypto.randomUUID()}`)
    mkdirSync(dir, { recursive: true })
    writeRegistry(dir, [
      {
        agent_id: "outer:lead",
        scope: "outer",
        profile: "lead",
        session_id: "ses_lead",
        display_name: "Lead",
        mission_id: null,
        node_id: null,
      },
      {
        agent_id: "inner:m-run:root",
        scope: "inner",
        profile: "build",
        session_id: "ses_run",
        display_name: "运行根",
        mission_id: "m-run",
        node_id: "root",
      },
      {
        agent_id: "inner:m-old:leaf",
        scope: "inner",
        profile: "build",
        session_id: "ses_old",
        display_name: "历史叶",
        mission_id: "m-old",
        node_id: "leaf",
      },
    ])
    writeFileSync(
      path.join(dir, ".gatehouse", "lead", "missions.yaml"),
      `schema_version: 1
missions:
  - id: m-run
    status: running
    started_at: "2026-06-01T00:00:00.000Z"
`,
    )

    const agents = await listSwitchableAgents(dir)
    const ids = agents.map((agent) => agent.agentId)
    expect(ids).toContain("outer:lead")
    expect(ids).toContain("inner:m-run:root")
    expect(ids).not.toContain("inner:m-old:leaf")
  })
})

describe("readRegistryAgentById", () => {
  test("loads active agent by id", () => {
    const dir = path.join(import.meta.dir, `.tmp-read-${crypto.randomUUID()}`)
    mkdirSync(dir, { recursive: true })
    writeRegistry(dir, [
      {
        agent_id: "outer:arbiter",
        scope: "outer",
        profile: "arbiter",
        session_id: "ses_arb",
        display_name: "仲裁",
        mission_id: null,
        node_id: null,
      },
    ])
    const agent = readRegistryAgentById(dir, "outer:arbiter")
    expect(agent?.sessionId).toBe("ses_arb")
    expect(agent?.opencodeAgent).toBe("arbiter")
    expect(readRegistryAgentById(dir, "missing")).toBeUndefined()
  })
})

describe("formatAgentDirectory", () => {
  test("includes current binding line", () => {
    const text = formatAgentDirectory(
      [
        {
          agentId: "outer:lead",
          scope: "outer",
          sessionId: "s",
          displayName: "Lead",
          opencodeAgent: "lead",
        },
      ],
      {
        currentAgentId: "outer:lead",
        currentMissionId: "m-run",
        descriptions: new Map([["outer:lead", "统筹任务规划与交付"]]),
      },
    )
    expect(text).toContain("当前对话：")
    expect(text).toContain("/agent outer:lead")
    expect(text).toContain("统筹任务规划与交付")
    expect(text).toContain("当前 mission：m-run")
    expect(text).toContain("可用 agent：")
  })
})

describe("loadAgentDescriptions", () => {
  test("reads inner descriptions from registry_tree_node", () => {
    const dir = path.join(import.meta.dir, `.tmp-desc-${crypto.randomUUID()}`)
    mkdirSync(dir, { recursive: true })
    writeRegistry(dir, [
      {
        agent_id: "inner:m-run:root",
        scope: "inner",
        profile: "build",
        session_id: "ses_run",
        display_name: "运行根",
        mission_id: "m-run",
        node_id: "root",
      },
    ])
    const dbPath = path.join(dir, ".gatehouse", "registry.db")
    const db = new Database(dbPath)
    db.exec(`
      CREATE TABLE registry_tree_node (
        mission_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        parent_node_id TEXT,
        display_name TEXT,
        description TEXT,
        profile TEXT,
        skill_domain TEXT,
        PRIMARY KEY (mission_id, node_id)
      );
    `)
    db
      .query(
        `INSERT INTO registry_tree_node (
          mission_id, node_id, session_id, display_name, description
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run("m-run", "root", "ses_run", "运行根", "负责当前 mission 的根节点协调")
    db.close()

    const agents = [
      {
        agentId: "inner:m-run:root",
        scope: "inner",
        sessionId: "ses_run",
        displayName: "运行根",
        opencodeAgent: "build",
        missionId: "m-run",
        nodeId: "root",
      },
    ]
    const descriptions = loadAgentDescriptions(dir, agents)
    expect(descriptions.get("inner:m-run:root")).toBe("负责当前 mission 的根节点协调")
  })

  test("reads outer descriptions from global agent md", () => {
    const agentDir = path.join(import.meta.dir, `.tmp-outer-${crypto.randomUUID()}`, "agent")
    mkdirSync(agentDir, { recursive: true })
    writeFileSync(
      path.join(agentDir, "lead.md"),
      `---
name: lead
description: 统筹任务从规划到交付
---
`,
    )
    const prev = process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR
    process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR = path.dirname(agentDir)
    try {
      const agents = [
        {
          agentId: "outer:lead",
          scope: "outer",
          sessionId: "s",
          displayName: "Len",
          opencodeAgent: "lead",
        },
      ]
      const descriptions = loadAgentDescriptions("/tmp/unused", agents)
      expect(descriptions.get("outer:lead")).toBe("统筹任务从规划到交付")
    } finally {
      if (prev === undefined) delete process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR
      else process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR = prev
    }
  })
})

describe("formatAgentDirectoryForProject", () => {
  test("uses registry and agent md descriptions", () => {
    const dir = path.join(import.meta.dir, `.tmp-directory-${crypto.randomUUID()}`)
    mkdirSync(dir, { recursive: true })
    writeRegistry(dir, [
      {
        agent_id: "outer:lead",
        scope: "outer",
        profile: "lead",
        session_id: "ses_lead",
        display_name: "Len",
        mission_id: null,
        node_id: null,
      },
    ])
    const agentDir = path.join(import.meta.dir, `.tmp-outer-dir-${crypto.randomUUID()}`, "agent")
    mkdirSync(agentDir, { recursive: true })
    writeFileSync(
      path.join(agentDir, "lead.md"),
      `---
description: 统筹任务从规划到交付
---
`,
    )
    const prev = process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR
    process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR = path.dirname(agentDir)
    try {
      const text = formatAgentDirectoryForProject(
        dir,
        [
          {
            agentId: "outer:lead",
            scope: "outer",
            sessionId: "ses_lead",
            displayName: "Len",
            opencodeAgent: "lead",
          },
        ],
        { currentAgentId: "outer:lead" },
      )
      expect(text).toContain("/agent outer:lead")
      expect(text).toContain("统筹任务从规划到交付")
    } finally {
      if (prev === undefined) delete process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR
      else process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR = prev
    }
  })
})
