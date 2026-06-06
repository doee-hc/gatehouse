import { test, expect, beforeAll, afterAll } from "bun:test"
import { existsSync, statSync } from "node:fs"
import path from "node:path"
import { buildPortalSnapshot } from "../src/portal/snapshot.ts"
import { readSkillDetail } from "../src/portal/skill.ts"
import { writeActiveMission } from "../src/portal/active-mission.ts"
import { RegistryDatabase } from "../src/registry/db.ts"
import { REGISTRY_SCHEMA_VERSION } from "../src/registry/types.ts"

const dir = path.join(import.meta.dir, ".tmp-portal-serial")
const trees = (id: string) => path.join(dir, ".gatehouse/architect/trees", id)

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
  for (const [id, status] of [
    ["m-a", "running"],
    ["m-b", "running"],
    ["m-done", "archived"],
  ] as const) {
    await Bun.write(
      path.join(trees(id), "manifest.yaml"),
      `mission_id: ${id}
status: ${status}
root_node: root
created_at: "2026-05-31T12:00:00Z"
nodes:
  root:
    session_id: ses-${id}-root
    parent: null
    display_name: "${id} · root"
    description: "${id} 任务协调者"
  leaf:
    session_id: ses-${id}-leaf
    parent: root
    display_name: "${id} · leaf"
    description: "${id} 执行成员"
`,
    )
  }
  await writeActiveMission(dir, "m-b")

  const registry = new RegistryDatabase(dir)
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
        agentId: "inner:m-a:root",
        scope: "inner",
        profile: "build-coordinator",
        sessionId: "ses-m-a-root",
        displayName: "m-a root",
        missionId: "m-a",
        nodeId: "root",
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
        agentId: "inner:m-b:root",
        scope: "inner",
        profile: "build-coordinator",
        sessionId: "ses-m-b-root",
        displayName: "m-b root",
        missionId: "m-b",
        nodeId: "root",
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
    retroCompletions: [],
    skillExtractRuns: [],
    skillExtractCompletions: [],
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
  expect(snap.tree?.mission_id).toBe("m-b")
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
  const root = snap.agents.find((agent) => agent.agent_id === "inner:m-b:root")
  expect(root?.description).toBe("m-b 任务协调者")
  expect(snap.tree?.nodes.find((node) => node.node_id === "leaf")?.description).toBe("m-b 执行成员")
})

test("buildPortalSnapshot excludes inner agents for done missions while another is running", async () => {
  const snap = await buildPortalSnapshot(dir)
  expect(snap.agents.some((agent) => agent.agent_id === "inner:m-done:leaf")).toBe(false)
})

test("buildPortalSnapshot includes lingering inner agents when no active mission", async () => {
  const lingeringDir = path.join(import.meta.dir, ".tmp-portal-lingering")
  const lingeringTreeDir = path.join(lingeringDir, ".gatehouse/architect/trees/m-last")
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
  await Bun.write(
    path.join(lingeringTreeDir, "manifest.yaml"),
    `mission_id: m-last
status: archived
root_node: root
created_at: "2026-05-31T12:00:00Z"
nodes:
  root:
    session_id: ses-m-last-root
    parent: null
    display_name: "m-last · root"
    description: "m-last 任务协调者"
  leaf:
    session_id: ses-m-last-leaf
    parent: root
    display_name: "m-last · leaf"
    description: "m-last 执行成员"
`,
  )
  const registry = new RegistryDatabase(lingeringDir)
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
        agentId: "inner:m-last:root",
        scope: "inner",
        profile: "build-coordinator",
        sessionId: "ses-m-last-root",
        displayName: "m-last root",
        missionId: "m-last",
        nodeId: "root",
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
    retroCompletions: [],
    skillExtractRuns: [],
    skillExtractCompletions: [],
  })

  const snap = await buildPortalSnapshot(lingeringDir)
  expect(snap.lingering_mission_id).toBe("m-last")
  expect(snap.tree?.mission_id).toBe("m-last")
  const innerIds = snap.agents.filter((agent) => agent.scope === "inner").map((agent) => agent.agent_id)
  expect(innerIds.sort()).toEqual(["inner:m-last:leaf", "inner:m-last:root"])
  expect(snap.agents.every((agent) => agent.scope !== "inner" || agent.lingering === true)).toBe(true)
  expect(snap.agents.every((agent) => agent.scope !== "inner" || agent.status === "idle")).toBe(true)
  await Bun.$`rm -rf ${lingeringDir}`.quiet()
})

test("buildPortalSnapshot includes retro mission tree and agents", async () => {
  const retroDir = path.join(import.meta.dir, ".tmp-portal-retro")
  const retroTreeDir = path.join(retroDir, ".gatehouse/architect/trees/m-retro")
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
  await Bun.write(
    path.join(retroTreeDir, "manifest.yaml"),
    `mission_id: m-retro
status: running
root_node: root
created_at: "2026-06-01T12:00:00Z"
nodes:
  root:
    session_id: ses-m-retro-root
    parent: null
    display_name: "retro root"
`,
  )
  const registry = new RegistryDatabase(retroDir)
  const now = new Date().toISOString()
  registry.save({
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    updatedAt: now,
    agents: [
      {
        agentId: "retro:m-retro:root",
        scope: "retro",
        profile: "build-coordinator",
        sessionId: "ses-m-retro-retro-root",
        displayName: "m-retro retro root",
        missionId: "m-retro",
        nodeId: "root",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    ],
    pendingDeliveries: [],
    retroRuns: [{ missionId: "m-retro", expectedNodeIds: ["root"], startedAt: now }],
    retroCompletions: [],
    skillExtractRuns: [],
    skillExtractCompletions: [],
  })

  const snap = await buildPortalSnapshot(retroDir)
  expect(snap.retro_mission_ids).toEqual(["m-retro"])
  expect(snap.tree?.mission_id).toBe("m-retro")
  expect(snap.retro?.mission_id).toBe("m-retro")
  expect(snap.retro?.active).toBe(true)
  expect(snap.retro?.pending_node_ids).toEqual(["root"])
  const retroAgent = snap.agents.find((agent) => agent.scope === "retro")
  expect(retroAgent?.spawn_id).toBe("retro-root")
  expect(snap.agents.some((agent) => agent.scope === "retro" && agent.mission_id === "m-retro")).toBe(true)
  await Bun.$`rm -rf ${retroDir}`.quiet()
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
