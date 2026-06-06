import { describe, expect, test } from "bun:test"
import { mkdtemp, writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { setMissionStatus } from "../src/missions/store.ts"
import { RegistryDatabase } from "../src/registry/db.ts"
import {
  deactivateInnerAgentsForMissions,
  reconcileCompletedRetroAgents,
  reconcileInactiveMissionInnerAgents,
} from "../src/registry/mission-agents.ts"
import { buildPortalSnapshot } from "../src/portal/snapshot.ts"
import { REGISTRY_SCHEMA_VERSION } from "../src/registry/types.ts"
import { stringifyYaml } from "../src/yaml.ts"

describe("mission inner agent lifecycle", () => {
  test("deactivateInnerAgentsForMissions marks inner agents completed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-mission-agents-"))
    await mkdir(path.join(dir, ".gatehouse", "lead"), { recursive: true })
    const now = new Date().toISOString()
    const db = new RegistryDatabase(dir)
    db.save({
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      updatedAt: now,
      agents: [
        {
          agentId: "inner:m-a:root",
          scope: "inner",
          profile: "build-coordinator",
          sessionId: "ses-a",
          displayName: "m-a root",
          missionId: "m-a",
          nodeId: "root",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          agentId: "outer:lead",
          scope: "outer",
          profile: "lead",
          sessionId: "ses-heng",
          displayName: "Lead",
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

    expect(deactivateInnerAgentsForMissions(dir, ["m-a"])).toBe(1)
    const reloaded = db.load()
    expect(reloaded.agents.find((agent) => agent.agentId === "inner:m-a:root")?.status).toBe("completed")
    expect(reloaded.agents.find((agent) => agent.agentId === "outer:lead")?.status).toBe("active")
  })

  test("setMissionStatus done keeps inner agents as lingering display in snapshot", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-mission-agents-"))
    await mkdir(path.join(dir, ".gatehouse", "lead"), { recursive: true })
    await mkdir(path.join(dir, ".gatehouse", "architect", "trees", "m-a"), { recursive: true })
    await writeFile(
      path.join(dir, ".gatehouse", "lead", "missions.yaml"),
      stringifyYaml({
        schema_version: 2,
        missions: [{ id: "m-a", status: "running", done_when: [], must_not: [] }],
      }),
    )
    await writeFile(
      path.join(dir, ".gatehouse", "architect", "trees", "m-a", "manifest.yaml"),
      stringifyYaml({
        mission_id: "m-a",
        status: "running",
        root_node: "root",
        created_at: new Date().toISOString(),
        nodes: {
          root: { session_id: "ses-root", parent: null, display_name: "root", profile: "build-coordinator" },
        },
      }),
    )
    const now = new Date().toISOString()
    new RegistryDatabase(dir).save({
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      updatedAt: now,
      agents: [
        {
          agentId: "inner:m-a:root",
          scope: "inner",
          profile: "build-coordinator",
          sessionId: "ses-root",
          displayName: "m-a root",
          missionId: "m-a",
          nodeId: "root",
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

    await setMissionStatus(dir, "m-a", "done")
    const snap = await buildPortalSnapshot(dir)
    const lingering = snap.agents.find((agent) => agent.agent_id === "inner:m-a:root")
    expect(lingering !== undefined).toBe(true)
    expect(lingering?.lingering).toBe(true)
    expect(lingering?.status).toBe("idle")
    expect(snap.lingering_mission_id).toBe("m-a")
    expect(snap.tree?.mission_id).toBe("m-a")
  })

  test("reconcileInactiveMissionInnerAgents handles manual missions.yaml edits", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-mission-agents-"))
    await mkdir(path.join(dir, ".gatehouse", "lead"), { recursive: true })
    const now = new Date().toISOString()
    new RegistryDatabase(dir).save({
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      updatedAt: now,
      agents: [
        {
          agentId: "inner:m-done:leaf",
          scope: "inner",
          profile: "build",
          sessionId: "ses-leaf",
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

    const count = reconcileInactiveMissionInnerAgents(dir, {
      schema_version: 2,
      missions: [{ id: "m-done", status: "done", done_when: [], must_not: [] }],
    })
    expect(count).toBe(1)
  })

  test("reconcileCompletedRetroAgents deactivates fork agents when their node is recorded", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-mission-agents-"))
    const now = new Date().toISOString()
    new RegistryDatabase(dir).save({
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      updatedAt: now,
      agents: [
        {
          agentId: "retro:m-retro:root",
          scope: "retro",
          profile: "root",
          sessionId: "ses-retro-root",
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
      retroCompletions: [
        {
          missionId: "m-retro",
          nodeId: "root",
          reportPath: ".gatehouse/architect/trees/m-retro/reports/nodes/root-retro.md",
          sessionId: "ses-retro-root",
          completedAt: now,
        },
      ],
      skillExtractRuns: [],
      skillExtractCompletions: [],
    })

    expect(reconcileCompletedRetroAgents(dir)).toBe(1)
    const reloaded = new RegistryDatabase(dir).load()
    expect(reloaded.agents[0]?.status).toBe("completed")
  })

  test("reconcileCompletedRetroAgents deactivates only recorded retro nodes", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-mission-agents-"))
    const now = new Date().toISOString()
    new RegistryDatabase(dir).save({
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      updatedAt: now,
      agents: [
        {
          agentId: "retro:m-retro:root",
          scope: "retro",
          profile: "root",
          sessionId: "ses-retro-root",
          displayName: "m-retro retro root",
          missionId: "m-retro",
          nodeId: "root",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          agentId: "retro:m-retro:leaf",
          scope: "retro",
          profile: "build",
          sessionId: "ses-retro-leaf",
          displayName: "m-retro retro leaf",
          missionId: "m-retro",
          nodeId: "leaf",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      ],
      pendingDeliveries: [],
      retroRuns: [{ missionId: "m-retro", expectedNodeIds: ["root", "leaf"], startedAt: now }],
      retroCompletions: [
        {
          missionId: "m-retro",
          nodeId: "root",
          reportPath: ".gatehouse/architect/trees/m-retro/reports/nodes/root-retro.md",
          sessionId: "ses-retro-root",
          completedAt: now,
        },
      ],
      skillExtractRuns: [],
      skillExtractCompletions: [],
    })

    expect(reconcileCompletedRetroAgents(dir)).toBe(1)
    const reloaded = new RegistryDatabase(dir).load()
    expect(reloaded.agents.find((agent) => agent.nodeId === "root")?.status).toBe("completed")
    expect(reloaded.agents.find((agent) => agent.nodeId === "leaf")?.status).toBe("active")
  })
})
