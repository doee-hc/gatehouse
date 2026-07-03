import { test, expect, beforeEach, afterEach } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  buildMissionStats,
  buildOuterOverview,
  buildTeamStatsSnapshot,
  clearTeamStatsCacheForTests,
  usageFromNodeMetrics,
  usageFromSessionDetail,
  usageFromSessionMessages,
} from "../src/portal/team-stats.ts"
import { RegistryDatabase } from "../src/registry/db.ts"
import { emptyTokens } from "../src/metrics/aggregate.ts"
import type { MissionEntry } from "../src/missions/parse.ts"
import type { RegistryAgent } from "../src/registry/types.ts"
import type { TreeManifest } from "../src/tree/types.ts"

beforeEach(() => {
  clearTeamStatsCacheForTests()
})

test("usageFromSessionDetail reads cost tokens and duration", () => {
  const usage = usageFromSessionDetail({
    cost: 0.42,
    tokens: {
      input: 100,
      output: 50,
      reasoning: 10,
      cache: { read: 5, write: 2 },
    },
    time: { created: 1_000, updated: 4_600 },
  })
  expect(usage.cost).toBe(0.42)
  expect(usage.tokens.input).toBe(100)
  expect(usage.tokens.output).toBe(50)
  expect(usage.tokens.reasoning).toBe(10)
  expect(usage.tokens.total).toBe(160)
  expect(usage.duration_ms).toBe(3_600)
})

test("usageFromSessionDetail handles missing detail", () => {
  const usage = usageFromSessionDetail(undefined)
  expect(usage.cost).toBe(0)
  expect(usage.tokens).toEqual(emptyTokens())
  expect(usage.duration_ms).toBe(0)
})

test("usageFromNodeMetrics reads dumped context metrics", () => {
  const usage = usageFromNodeMetrics({
    cost: 0.0158380544,
    duration_ms: 407_441,
    tokens: {
      input: 50_000,
      output: 30_000,
      reasoning: 5_000,
      cache: { read: 100, write: 0 },
      total: 85_000,
    },
  })
  expect(usage?.cost).toBe(0.0158380544)
  expect(usage?.duration_ms).toBe(407_441)
  expect(usage?.tokens.total).toBe(85_000)
})

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test("usageFromSessionMessages aggregates assistant message tokens", () => {
  const usage = usageFromSessionMessages([
    {
      info: {
        role: "assistant",
        tokens: { input: 40, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: 0.08,
      },
    },
    { info: { role: "user", content: "hi" } },
  ])
  expect(usage.tokens.total).toBe(50)
  expect(usage.cost).toBe(0.08)
})

test("buildTeamStatsSnapshot falls back to phase metrics when retro sessions are gone", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gh-team-stats-phase-"))
  try {
    await mkdir(path.join(dir, ".gatehouse/lead"), { recursive: true })
    await mkdir(path.join(dir, ".gatehouse/trees/m1/context/retro/node-root"), { recursive: true })
    await writeFile(
      path.join(dir, ".gatehouse/lead/missions.yaml"),
      `schema_version: 1
missions:
  - id: m1
    status: done
    objective: Phase metrics fallback
    done_when: []
    must_not: []
`,
    )
    await writeFile(
      path.join(dir, ".gatehouse/trees-index.yaml"),
      `schema_version: 1
trees:
  - mission_id: m1
    status: archived
`,
    )
    await mkdir(path.join(dir, ".gatehouse/internal/exports/trees/m1"), { recursive: true })
    await writeFile(
      path.join(dir, ".gatehouse/internal/exports/trees/m1/manifest.yaml"),
      `mission_id: m1
status: archived
terminal_node: node-root
created_at: 2026-06-12T00:00:00.000Z
nodes:
  node-root:
    session_id: ses-exec
    display_name: root
`,
    )
    await writeFile(
      path.join(dir, ".gatehouse/internal/exports/trees/m1/retro-manifest.yaml"),
      `mission_id: m1
created_at: 2026-06-12T01:00:00.000Z
retro_session_id: ses-retro
analysis_order:
  - node-root
`,
    )
    await mkdir(path.join(dir, ".gatehouse/trees/m1/context/retro/retro-analyst"), { recursive: true })
    await writeFile(
      path.join(dir, ".gatehouse/trees/m1/context/retro/retro-analyst/metrics.json"),
      JSON.stringify({
        mission_id: "m1",
        phase: "retro",
        node_id: "node-root",
        session_id: "ses-retro",
        duration_ms: 90_000,
        cost: 0.21,
        tokens: { input: 200, output: 40, reasoning: 0, cache: { read: 0, write: 0 }, total: 240 },
      }),
    )

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? new URL(input) : input instanceof URL ? input : new URL(input.url)
      if (url.pathname === "/global/health") {
        return new Response(JSON.stringify({ healthy: true }), { status: 200 })
      }
      if (url.pathname.startsWith("/session/")) {
        return new Response(JSON.stringify({ message: "not found" }), { status: 404 })
      }
      return new Response("not found", { status: 404 })
    }) as typeof fetch

    new RegistryDatabase(dir)
    clearTeamStatsCacheForTests()
    const snapshot = await buildTeamStatsSnapshot(dir, "http://127.0.0.1:4096")
    const retroRole = snapshot.missions[0]?.roles.find((role) => role.session_id === "ses-retro")
    expect(retroRole?.tokens.total).toBe(240)
    expect(retroRole?.cost).toBe(0.21)
    expect(retroRole?.duration_ms).toBe(90_000)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("buildTeamStatsSnapshot aggregates retro tokens from session messages when detail is empty", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gh-team-stats-msg-"))
  try {
    await mkdir(path.join(dir, ".gatehouse/lead"), { recursive: true })
    await writeFile(
      path.join(dir, ".gatehouse/lead/missions.yaml"),
      `schema_version: 1
missions:
  - id: m1
    status: retro
    objective: Message fallback
    done_when: []
    must_not: []
`,
    )
    await writeFile(
      path.join(dir, ".gatehouse/trees-index.yaml"),
      `schema_version: 1
trees:
  - mission_id: m1
    status: running
`,
    )
    await mkdir(path.join(dir, ".gatehouse/internal/exports/trees/m1"), { recursive: true })
    await writeFile(
      path.join(dir, ".gatehouse/internal/exports/trees/m1/manifest.yaml"),
      `mission_id: m1
status: running
terminal_node: node-root
created_at: 2026-06-12T00:00:00.000Z
nodes:
  node-root:
    session_id: ses-exec
    display_name: root
`,
    )
    await writeFile(
      path.join(dir, ".gatehouse/internal/exports/trees/m1/retro-manifest.yaml"),
      `mission_id: m1
created_at: 2026-06-12T01:00:00.000Z
retro_session_id: ses-retro
analysis_order:
  - node-root
`,
    )

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? new URL(input) : input instanceof URL ? input : new URL(input.url)
      if (url.pathname === "/global/health") {
        return new Response(JSON.stringify({ healthy: true }), { status: 200 })
      }
      if (url.pathname === "/session/ses-retro") {
        return new Response(JSON.stringify({ data: { id: "ses-retro", time: { created: 0, updated: 60_000 } } }), {
          status: 200,
        })
      }
      if (url.pathname === "/session/ses-retro/message") {
        return new Response(
          JSON.stringify({
            data: [
              {
                info: {
                  role: "assistant",
                  tokens: { input: 300, output: 60, reasoning: 0, cache: { read: 0, write: 0 } },
                  cost: 0.12,
                },
              },
            ],
          }),
          { status: 200 },
        )
      }
      if (url.pathname.startsWith("/session/")) {
        return new Response(JSON.stringify({ data: {} }), { status: 200 })
      }
      return new Response("not found", { status: 404 })
    }) as typeof fetch

    new RegistryDatabase(dir)
    clearTeamStatsCacheForTests()
    const snapshot = await buildTeamStatsSnapshot(dir, "http://127.0.0.1:4096")
    const retroRole = snapshot.missions[0]?.roles.find((role) => role.session_id === "ses-retro")
    expect(retroRole?.tokens.total).toBe(360)
    expect(retroRole?.cost).toBe(0.12)
    expect(retroRole?.duration_ms).toBe(60_000)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("buildTeamStatsSnapshot falls back to local context metrics when OpenCode sessions are gone", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gh-team-stats-local-"))
  try {
    await mkdir(path.join(dir, ".gatehouse/lead"), { recursive: true })
    await mkdir(path.join(dir, ".gatehouse/trees/m1/context/root"), { recursive: true })
    await writeFile(
      path.join(dir, ".gatehouse/lead/missions.yaml"),
      `schema_version: 1
missions:
  - id: m1
    status: done
    objective: Local metrics fallback
    done_when: []
    must_not: []
`,
    )
    await writeFile(
      path.join(dir, ".gatehouse/trees-index.yaml"),
      `schema_version: 1
trees:
  - mission_id: m1
    status: archived
`,
    )
    await mkdir(path.join(dir, ".gatehouse/internal/exports/trees/m1"), { recursive: true })
    await writeFile(
      path.join(dir, ".gatehouse/internal/exports/trees/m1/manifest.yaml"),
      `mission_id: m1
status: archived
terminal_node: root
created_at: 2026-06-12T00:00:00.000Z
nodes:
  root:
    session_id: ses-archived
    display_name: root
`,
    )
    await writeFile(
      path.join(dir, ".gatehouse/trees/m1/context/root/metrics.json"),
      JSON.stringify({
        mission_id: "m1",
        node_id: "root",
        session_id: "ses-archived",
        duration_ms: 120_000,
        cost: 0.42,
        tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 }, total: 150 },
      }),
    )

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? new URL(input) : input instanceof URL ? input : new URL(input.url)
      if (url.pathname === "/global/health") {
        return new Response(JSON.stringify({ healthy: true }), { status: 200 })
      }
      if (url.pathname.startsWith("/session/")) {
        return new Response(JSON.stringify({ message: "not found" }), { status: 404 })
      }
      return new Response("not found", { status: 404 })
    }) as typeof fetch

    new RegistryDatabase(dir)
    clearTeamStatsCacheForTests()
    const snapshot = await buildTeamStatsSnapshot(dir, "http://127.0.0.1:4096")
    expect(snapshot.missions).toHaveLength(1)
    expect(snapshot.missions[0]?.cost).toBe(0.42)
    expect(snapshot.missions[0]?.tokens.total).toBe(150)
    expect(snapshot.missions[0]?.duration_ms).toBe(120_000)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("buildMissionStats aggregates inner node sessions", () => {
  const mission: MissionEntry = {
    id: "m1",
    status: "done",
    objective: "Smoke test",
    done_when: [],
    must_not: [],
    started_at: "2026-05-29T09:00:00Z",
    completed_at: "2026-05-29T12:00:00Z",
  }
  const manifest: TreeManifest = {
    mission_id: "m1",
    status: "archived",
    terminal_node: "root",
    created_at: "2026-05-29T09:00:00Z",
    nodes: {
      terminal: { session_id: "ses-root", display_name: "m1 · root" },
      leaf: { session_id: "ses-leaf", display_name: "m1 · leaf" },
    },
  }
  const usage = new Map([
    ["ses-root", usageFromSessionDetail({ cost: 0.1, tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } } })],
    ["ses-leaf", usageFromSessionDetail({ cost: 0.2, tokens: { input: 20, output: 8, reasoning: 0, cache: { read: 0, write: 0 } } })],
  ])

  const stats = buildMissionStats(mission, manifest, usage)
  expect(Math.round(stats.cost * 100)).toBe(30)
  expect(stats.tokens.input).toBe(30)
  expect(stats.tokens.total).toBe(43)
  expect(stats.roles).toHaveLength(2)
  expect(stats.wall_clock_ms).toBe(3 * 60 * 60 * 1000)
})

test("buildMissionStats includes retro extract and verify sessions", () => {
  const mission: MissionEntry = {
    id: "m1",
    status: "retro",
    objective: "Retro phase",
    done_when: [],
    must_not: [],
  }
  const manifest: TreeManifest = {
    mission_id: "m1",
    status: "running",
    terminal_node: "node-root",
    created_at: "2026-06-12T00:00:00.000Z",
    nodes: {
      "node-root": { session_id: "ses-exec", display_name: "m1 · root" },
    },
  }
  const retro = {
    mission_id: "m1",
    created_at: "2026-06-12T01:00:00.000Z",
    retro_session_id: "ses-retro",
    analysis_order: ["node-root"],
  }
  const extract = {
    mission_id: "m1",
    created_at: "2026-06-12T01:00:00.000Z",
    extract_order: ["node-root"],
    nodes: {
      "node-root": { exec_session_id: "ses-exec", extract_session_id: "ses-extract", skill_domain: "demo" },
    },
  }
  const verify = {
    mission_id: "m1",
    created_at: "2026-06-12T02:00:00.000Z",
    verify_order: ["node-root"],
    nodes: {
      "node-root": { extract_session_id: "ses-extract", verify_session_id: "ses-verify", skill_domain: "demo" },
    },
  }
  const usage = new Map([
    ["ses-exec", usageFromSessionDetail({ cost: 0.1, tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } } })],
    ["ses-retro", usageFromSessionDetail({ cost: 0.2, tokens: { input: 50, output: 5, reasoning: 0, cache: { read: 0, write: 0 } } })],
    ["ses-extract", usageFromSessionDetail({ cost: 0.05, tokens: { input: 20, output: 2, reasoning: 0, cache: { read: 0, write: 0 } } })],
    ["ses-verify", usageFromSessionDetail({ cost: 0.03, tokens: { input: 10, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } })],
  ])

  const stats = buildMissionStats(mission, manifest, usage, retro, extract, verify)
  expect(stats.roles).toHaveLength(4)
  expect(stats.tokens.total).toBe(198)
  expect(Math.round(stats.cost * 100)).toBe(38)
  expect(stats.roles.some((role) => role.session_id === "ses-retro" && role.label.includes("[retro]"))).toBe(true)
  expect(stats.roles.some((role) => role.session_id === "ses-extract" && role.label.includes("[extract]"))).toBe(true)
  expect(stats.roles.some((role) => role.session_id === "ses-verify" && role.label.includes("[verify]"))).toBe(true)
})

test("buildOuterOverview lists active outer agents", () => {
  const now = new Date().toISOString()
  const agents: RegistryAgent[] = [
    {
      agentId: "outer:lead",
      scope: "outer",
      profile: "lead",
      sessionId: "ses-lead",
      displayName: "Lead",
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
    {
      agentId: "inner:m1:root",
      scope: "inner",
      profile: "build",
      sessionId: "ses-inner",
      displayName: "worker",
      missionId: "m1",
      nodeId: "terminal",
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
  ]
  const usage = new Map([
    ["ses-lead", usageFromSessionDetail({ cost: 1.5, tokens: { input: 1000, output: 200, reasoning: 0, cache: { read: 0, write: 0 } } })],
  ])

  const outer = buildOuterOverview(
    agents,
    { lead: "Lead", architect: "Architect", curator: "Curator", arbiter: "Arbiter" },
    usage,
  )
  expect(outer).toHaveLength(1)
  expect(outer[0]?.label).toBe("Lead")
  expect(outer[0]?.cost).toBe(1.5)
})
