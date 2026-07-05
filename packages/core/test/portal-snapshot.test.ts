import { test, expect, beforeAll, afterAll } from "bun:test"
import { existsSync, statSync } from "node:fs"
import path from "node:path"
import { buildPortalSnapshot } from "../src/portal/snapshot.ts"
import { readSkillDetail } from "../src/portal/skill.ts"
import { writeActiveMission } from "../src/portal/active-mission.ts"
import { RegistryDatabase } from "../src/registry/db.ts"
import { REGISTRY_SCHEMA_VERSION } from "../src/registry/types.ts"

const dir = path.join(import.meta.dir, ".tmp-portal-serial")
const trees = (id: string) => path.join(dir, ".gatehouse/missions", id)

beforeAll(async () => {
  await Bun.$`rm -rf ${dir} && mkdir -p ${dir}/.gatehouse/lead ${trees("m-a")} ${trees("m-b")} ${trees("m-done")}`.quiet()
  await Bun.write(
    path.join(dir, ".gatehouse/lead/missions.yaml"),
    `schema_version: 2
missions:
  - id: m-a
    status: running
    started_at: "2026-05-30T10:00:00Z"
  - id: m-b
    status: running
    started_at: "2026-05-31T11:00:00Z"
  - id: m-done
    status: done
    started_at: "2026-05-29T09:00:00Z"
    completed_at: "2026-05-29T12:00:00Z"
`,
  )
  const registry = new RegistryDatabase(dir)
  for (const [id, status] of [
    ["m-a", "running"],
    ["m-b", "running"],
    ["m-done", "archived"],
  ] as const) {
    registry.saveMissionManifest({
      mission_id: id,
      status,
      terminal_node: "terminal",
      created_at: "2026-05-31T12:00:00Z",
      nodes: {
        terminal: {
          session_id: `ses-${id}-terminal`,
          display_name: `${id} · terminal`,
          description: `${id} 任务协调者`,
        },
        leaf: {
          session_id: `ses-${id}-leaf`,
          display_name: `${id} · leaf`,
          description: `${id} 执行成员`,
        },
      },
    })
  }
  await writeActiveMission(dir, "m-b")

  const now = new Date().toISOString()
  registry.save({
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    updatedAt: now,
    agents: [
      {
        agentId: "outer:lead",
        scope: "outer",
        profile: "lead",
        sessionId: "ses-hengduan",
        displayName: "Lead",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
      {
        agentId: "inner:m-a:terminal",
        scope: "inner",
        profile: "build",
        sessionId: "ses-m-a-terminal",
        displayName: "m-a terminal",
        missionId: "m-a",
        nodeId: "terminal",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
      {
        agentId: "inner:m-a:leaf",
        scope: "inner",
        profile: "build",
        sessionId: "ses-m-a-leaf",
        displayName: "m-a leaf",
        missionId: "m-a",
        nodeId: "leaf",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
      {
        agentId: "inner:m-b:terminal",
        scope: "inner",
        profile: "build",
        sessionId: "ses-m-b-terminal",
        displayName: "m-b terminal",
        missionId: "m-b",
        nodeId: "terminal",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
      {
        agentId: "inner:m-b:leaf",
        scope: "inner",
        profile: "build",
        sessionId: "ses-m-b-leaf",
        displayName: "m-b leaf",
        missionId: "m-b",
        nodeId: "leaf",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
      {
        agentId: "inner:m-done:leaf",
        scope: "inner",
        profile: "build",
        sessionId: "ses-m-done-leaf",
        displayName: "m-done leaf",
        missionId: "m-done",
        nodeId: "leaf",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    ],
    pendingDeliveries: [],
    retroRuns: [],
    
    skillExtractRuns: [],
    skillExtractCompletions: [],
    skillVerifyRuns: [],
    skillVerifyCompletions: [],
  })
})

afterAll(async () => {
  await Bun.$`rm -rf ${dir}`.quiet()
})

test("buildPortalSnapshot does not persist registry or office layout files", async () => {
  const layoutPath = path.join(dir, ".gatehouse/portal/office-layout.yaml")
  const registryPath = path.join(dir, ".gatehouse/registry.db")
  const layoutBefore = existsSync(layoutPath) ? statSync(layoutPath).mtimeMs : 0
  const registryBefore = existsSync(registryPath) ? statSync(registryPath).mtimeMs : 0

  await buildPortalSnapshot(dir)

  const layoutAfter = existsSync(layoutPath) ? statSync(layoutPath).mtimeMs : 0
  const registryAfter = existsSync(registryPath) ? statSync(registryPath).mtimeMs : 0
  expect(layoutAfter).toBe(layoutBefore)
  expect(registryAfter).toBe(registryBefore)
})

test("buildPortalSnapshot exposes only the newest running mission", async () => {
  const snap = await buildPortalSnapshot(dir)
  expect(snap.running_mission_ids?.sort()).toEqual(["m-a", "m-b"])
  expect(snap.team?.mission_id).toBe("m-b")
  expect(snap.active_mission_id).toBe("m-b")
  expect("trees" in snap).toBe(false)
})

test("buildPortalSnapshot includes inner agents only for active mission", async () => {
  const snap = await buildPortalSnapshot(dir)
  const innerIds = snap.agents.filter((agent) => agent.scope === "inner").map((agent) => agent.mission_id)
  expect(innerIds.sort()).toEqual(["m-b", "m-b"])
})

test("buildPortalSnapshot uses manifest description for inner agents", async () => {
  const snap = await buildPortalSnapshot(dir)
  const terminal = snap.agents.find((agent) => agent.agent_id === "inner:m-b:terminal")
  expect(terminal?.description).toBe("m-b 任务协调者")
  expect(snap.team?.nodes.find((node) => node.node_id === "leaf")?.description).toBe("m-b 执行成员")
})

test("buildPortalSnapshot excludes inner agents for done missions while another is running", async () => {
  const snap = await buildPortalSnapshot(dir)
  expect(snap.agents.some((agent) => agent.agent_id === "inner:m-done:leaf")).toBe(false)
})

test("buildPortalSnapshot includes lingering inner agents when no active mission", async () => {
  const lingeringDir = path.join(import.meta.dir, ".tmp-portal-lingering")
  const lingeringTreeDir = path.join(lingeringDir, ".gatehouse/missions/m-last")
  await Bun.$`rm -rf ${lingeringDir} && mkdir -p ${lingeringDir}/.gatehouse/lead ${lingeringTreeDir}`.quiet()
  await Bun.write(
    path.join(lingeringDir, ".gatehouse/lead/missions.yaml"),
    `schema_version: 2
missions:
  - id: m-old
    status: done
    started_at: "2026-05-29T09:00:00Z"
    completed_at: "2026-05-29T12:00:00Z"
  - id: m-last
    status: done
    started_at: "2026-05-31T11:00:00Z"
    completed_at: "2026-05-31T14:00:00Z"
`,
  )
  const registry = new RegistryDatabase(lingeringDir)
  registry.saveMissionManifest({
    mission_id: "m-last",
    status: "archived",
    terminal_node: "terminal",
    created_at: "2026-05-31T12:00:00Z",
    nodes: {
      terminal: {
        session_id: "ses-m-last-terminal",
        display_name: "m-last · terminal",
        description: "m-last 任务协调者",
      },
      leaf: {
        session_id: "ses-m-last-leaf",
        display_name: "m-last · leaf",
        description: "m-last 执行成员",
      },
    },
  })
  const now = new Date().toISOString()
  registry.save({
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    updatedAt: now,
    agents: [
      {
        agentId: "outer:lead",
        scope: "outer",
        profile: "lead",
        sessionId: "ses-hengduan",
        displayName: "Lead",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
      {
        agentId: "inner:m-last:terminal",
        scope: "inner",
        profile: "build",
        sessionId: "ses-m-last-terminal",
        displayName: "m-last terminal",
        missionId: "m-last",
        nodeId: "terminal",
        status: "completed",
        createdAt: now,
        updatedAt: now,
      },
      {
        agentId: "inner:m-last:leaf",
        scope: "inner",
        profile: "build",
        sessionId: "ses-m-last-leaf",
        displayName: "m-last leaf",
        missionId: "m-last",
        nodeId: "leaf",
        status: "completed",
        createdAt: now,
        updatedAt: now,
      },
      {
        agentId: "inner:m-old:leaf",
        scope: "inner",
        profile: "build",
        sessionId: "ses-m-old-leaf",
        displayName: "m-old leaf",
        missionId: "m-old",
        nodeId: "leaf",
        status: "completed",
        createdAt: now,
        updatedAt: now,
      },
    ],
    pendingDeliveries: [],
    retroRuns: [],
    
    skillExtractRuns: [],
    skillExtractCompletions: [],
    skillVerifyRuns: [],
    skillVerifyCompletions: [],
  })

  const snap = await buildPortalSnapshot(lingeringDir)
  expect(snap.lingering_mission_id).toBe("m-last")
  expect(snap.team?.mission_id).toBe("m-last")
  const innerIds = snap.agents.filter((agent) => agent.scope === "inner").map((agent) => agent.agent_id)
  expect(innerIds.sort()).toEqual(["inner:m-last:leaf", "inner:m-last:terminal"])
  expect(snap.agents.every((agent) => agent.scope !== "inner" || agent.lingering === true)).toBe(true)
  expect(snap.agents.every((agent) => agent.scope !== "inner" || agent.status === "idle")).toBe(true)
  await Bun.$`rm -rf ${lingeringDir}`.quiet()
})

test("buildPortalSnapshot includes retro mission tree and agents", async () => {
  const retroDir = path.join(import.meta.dir, ".tmp-portal-retro")
  const retroTreeDir = path.join(retroDir, ".gatehouse/missions/m-retro")
  await Bun.$`rm -rf ${retroDir} && mkdir -p ${retroDir}/.gatehouse/lead ${retroTreeDir}`.quiet()
  await Bun.write(
    path.join(retroDir, ".gatehouse/lead/missions.yaml"),
    `schema_version: 2
missions:
  - id: m-retro
    status: retro
    started_at: "2026-06-01T10:00:00Z"
`,
  )
  const registry = new RegistryDatabase(retroDir)
  registry.saveMissionManifest({
    mission_id: "m-retro",
    status: "running",
    terminal_node: "terminal",
    created_at: "2026-06-01T12:00:00Z",
    nodes: {
      terminal: {
        session_id: "ses-m-retro-terminal",
        display_name: "retro terminal",
      },
    },
  })
  const now = new Date().toISOString()
  registry.save({
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    updatedAt: now,
    agents: [
      {
        agentId: "retro:m-retro",
        scope: "retro",
        profile: "retro-analyst",
        sessionId: "ses-m-retro-analyst",
        displayName: "[retro] m-retro",
        missionId: "m-retro",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    ],
    pendingDeliveries: [],
    retroRuns: [{ missionId: "m-retro", startedAt: now }],
    
    skillExtractRuns: [],
    skillExtractCompletions: [],
    skillVerifyRuns: [],
    skillVerifyCompletions: [],
  })

  const snap = await buildPortalSnapshot(retroDir)
  expect(snap.retro_mission_ids).toEqual(["m-retro"])
  expect(snap.team?.mission_id).toBe("m-retro")
  expect(snap.retro?.mission_id).toBe("m-retro")
  expect(snap.retro?.active).toBe(true)
  expect(snap.retro?.summary_submitted).toBe(false)
  const retroAgent = snap.agents.find((agent) => agent.scope === "retro")
  expect(retroAgent?.spawn_id).toBe("retro-analyst")
  expect(snap.agents.some((agent) => agent.scope === "retro" && agent.mission_id === "m-retro")).toBe(true)
  await Bun.$`rm -rf ${retroDir}`.quiet()
})

test("buildPortalSnapshot includes direction from lead/direction.yaml", async () => {
  await Bun.write(
    path.join(dir, ".gatehouse/lead/direction.yaml"),
    `schema_version: 1
status: confirmed
summary: |
  Ship portal UX improvements first.
constraints:
  - "No production config changes"
confirmed_at: "2026-06-01T00:00:00.000Z"
review_after: "2026-12-01"
`,
  )

  const snap = await buildPortalSnapshot(dir)
  expect(snap.direction?.status).toBe("confirmed")
  expect(snap.direction?.confirmed).toBe(true)
  expect(snap.direction?.summary).toContain("portal UX")
  expect(snap.direction?.constraints).toEqual(["No production config changes"])
  expect(snap.direction?.review_after).toBe("2026-12-01")
})

test("readSkillDetail returns markdown for by-domain skills", async () => {
  const skillDir = path.join(dir, ".gatehouse/skills/by-domain/demo-domain/demo-skill")
  await Bun.$`mkdir -p ${skillDir}`.quiet()
  await Bun.write(
    path.join(skillDir, "SKILL.md"),
    `---
name: demo-skill
description: Demo skill for portal
---
# Demo body
`,
  )
  const detail = await readSkillDetail(dir, "demo-domain", "demo-skill")
  expect(detail?.name).toBe("demo-skill")
  expect(detail?.domain).toBe("demo-domain")
  expect(detail?.markdown).toContain("# Demo body")
  expect(detail?.path).toBe(".gatehouse/skills/by-domain/demo-domain/demo-skill/SKILL.md")
  expect(await readSkillDetail(dir, "demo-domain", "missing")).toBeUndefined()
  expect(await readSkillDetail(dir, "../evil", "demo-skill")).toBeUndefined()
})
