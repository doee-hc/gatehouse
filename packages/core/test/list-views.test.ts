import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { RegistryStore } from "../src/registry/store.ts"
import { seedActiveMissionRegistry } from "./copy-example-mission.ts"
import { buildListTeamData, type ListTeamPayload } from "../src/tools/list-views.ts"
import { sampleMissionManifest } from "./helpers/mission-fixtures.ts"
import { writeMissionManifest, writeRetroManifest } from "../src/missions/manifest/store.ts"

async function storeWithAgents(
  agents: Array<{
    agentId: string
    scope: "outer" | "inner" | "retro"
    profile: string
    sessionId: string
    displayName: string
    missionId?: string
    nodeId?: string
  }>,
) {
  const dir = await mkdtemp(path.join(tmpdir(), "gh-list-views-"))
  await mkdir(path.join(dir, ".gatehouse", "lead"), { recursive: true })
  const store = await RegistryStore.create({ directory: dir, client: {} as never })
  for (const agent of agents) {
    store.register({
      agentId: agent.agentId,
      scope: agent.scope,
      profile: agent.profile,
      sessionId: agent.sessionId,
      displayName: agent.displayName,
      ...(agent.missionId && { missionId: agent.missionId }),
      ...(agent.nodeId && { nodeId: agent.nodeId }),
    })
  }
  return { dir, store }
}

function expectPayload(data: Awaited<ReturnType<typeof buildListTeamData>>): ListTeamPayload {
  if ("error" in data) throw new Error(data.error)
  return data
}

const sampleManifest = () =>
  sampleMissionManifest({
    mission_id: "m1",
    terminal_node: "root",
    created_at: "2026-01-01T00:00:00Z",
    status: "running",
    nodes: {
      root: {
        session_id: "ses-root",
        description: "协调根",
        profile: "build",
      },
      leaf: {
        session_id: "ses-leaf",
        description: "执行叶",
        profile: "build",
      },
    },
  })

describe("buildListTeamData", () => {
  test("lead sees outer readiness and execution team without session_id", async () => {
    const { store, dir } = await storeWithAgents([
      {
        agentId: "outer:architect",
        scope: "outer",
        profile: "architect",
        sessionId: "ses-a",
        displayName: "Architect",
      },
    ])
    seedActiveMissionRegistry(dir, "m1")
    await writeMissionManifest(dir, sampleManifest())
    store.register({
      agentId: "inner:m1:root",
      scope: "inner",
      profile: "build",
      sessionId: "ses-root",
      displayName: "root",
      missionId: "m1",
      nodeId: "terminal",
    })
    store.register({
      agentId: "inner:m1:leaf",
      scope: "inner",
      profile: "build",
      sessionId: "ses-leaf",
      displayName: "leaf",
      missionId: "m1",
      nodeId: "leaf",
    })
    const data = await buildListTeamData({
      store,
      directory: dir,
      callerProfile: "lead",
      sessionId: "ses-lead",
    })
    const payload = expectPayload(data)
    expect(payload.outer?.find((item) => item.profile === "architect")?.ready).toBe(true)
    expect(payload.outer?.find((item) => item.profile === "curator")?.ready).toBe(false)
    expect(payload.execution?.map((item) => item.node_id).sort()).toEqual(["leaf", "root"])
    expect(payload.execution?.every((item) => !("session_id" in item))).toBe(true)
  })

  test("architect sees outer contacts and execution without session_id", async () => {
    const { store, dir } = await storeWithAgents([
      {
        agentId: "outer:lead",
        scope: "outer",
        profile: "lead",
        sessionId: "ses-l",
        displayName: "Lead",
      },
      {
        agentId: "outer:architect",
        scope: "outer",
        profile: "architect",
        sessionId: "ses-a",
        displayName: "Architect",
      },
    ])
    seedActiveMissionRegistry(dir, "m1")
    await writeMissionManifest(dir, sampleManifest())
    const data = await buildListTeamData({
      store,
      directory: dir,
      callerProfile: "architect",
      sessionId: "ses-a",
    })
    const payload = expectPayload(data)
    expect(payload.outer?.map((item) => item.profile).sort()).toEqual(["architect", "lead"])
    expect(payload.execution?.length).toBe(2)
    expect(payload.execution?.every((item) => !("session_id" in item))).toBe(true)
  })

  test("arbiter sees session_id on roster entries", async () => {
    const { store, dir } = await storeWithAgents([
      {
        agentId: "inner:m1:root",
        scope: "inner",
        profile: "build",
        sessionId: "ses-r",
        displayName: "root",
        missionId: "m1",
        nodeId: "terminal",
      },
    ])
    seedActiveMissionRegistry(dir, "m1")
    await writeMissionManifest(dir, sampleManifest())
    const data = await buildListTeamData({
      store,
      directory: dir,
      callerProfile: "arbiter",
      sessionId: "ses-arbiter",
    })
    const payload = expectPayload(data)
    expect(payload.execution?.find((item) => item.node_id === "root")?.session_id).toBe("ses-r")
    expect(payload.execution?.find((item) => item.node_id === "leaf")?.session_id).toBeUndefined()
  })

  test("inner terminal node sees lead and all execution nodes", async () => {
    const { store, dir } = await storeWithAgents([
      {
        agentId: "outer:lead",
        scope: "outer",
        profile: "lead",
        sessionId: "ses-l",
        displayName: "Lead",
      },
    ])
    seedActiveMissionRegistry(dir, "m1")
    await writeMissionManifest(dir, sampleManifest())
    const data = await buildListTeamData({
      store,
      directory: dir,
      callerProfile: "build",
      sessionId: "ses-root",
    })
    const payload = expectPayload(data)
    expect(payload.outer).toEqual([{ profile: "lead", display_name: "Lead" }])
    expect(payload.execution?.length).toBe(2)
  })

  test("inner leaf sees execution only", async () => {
    const { store, dir } = await storeWithAgents([])
    seedActiveMissionRegistry(dir, "m1")
    await writeMissionManifest(dir, sampleManifest())
    const data = await buildListTeamData({
      store,
      directory: dir,
      callerProfile: "build",
      sessionId: "ses-leaf",
    })
    const payload = expectPayload(data)
    expect(payload.outer).toBeUndefined()
    expect(payload.execution?.length).toBe(2)
  })

  test("retro analyst session sees full execution team", async () => {
    const { store, dir } = await storeWithAgents([])
    seedActiveMissionRegistry(dir, "m1")
    const manifest = sampleMissionManifest({
      mission_id: "m1",
      terminal_node: "root",
      created_at: "2026-01-01T00:00:00Z",
      status: "running",
      nodes: {
        root: { session_id: "ses-root", description: "根", profile: "build" },
        mid: { session_id: "ses-mid", description: "中层", profile: "build" },
        leaf: { session_id: "ses-leaf", description: "叶", profile: "build" },
      },
    })
    await writeMissionManifest(dir, manifest)
    store.register({
      agentId: "retro:m1",
      scope: "retro",
      profile: "retro-analyst",
      sessionId: "ses-retro",
      displayName: "[retro] m1",
      missionId: "m1",
    })
    await writeRetroManifest(dir, {
      mission_id: "m1",
      created_at: "2026-01-01T00:00:00Z",
      retro_session_id: "ses-retro",
      analysis_order: ["leaf", "mid", "root"],
    })
    const data = await buildListTeamData({
      store,
      directory: dir,
      callerProfile: "retro-analyst",
      sessionId: "ses-retro",
    })
    const payload = expectPayload(data)
    expect(payload.execution?.map((item) => item.node_id).sort()).toEqual(["leaf", "mid", "root"])
    expect(payload.you.node_id).toBe("retro-analyst")
  })
})
