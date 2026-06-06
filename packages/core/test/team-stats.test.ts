import { test, expect, beforeEach } from "bun:test"
import {
  buildMissionStats,
  buildOuterOverview,
  clearTeamStatsCacheForTests,
  usageFromSessionDetail,
} from "../src/portal/team-stats.ts"
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
    root_node: "root",
    created_at: "2026-05-29T09:00:00Z",
    nodes: {
      root: { session_id: "ses-root", parent: null, display_name: "m1 · root" },
      leaf: { session_id: "ses-leaf", parent: "root", display_name: "m1 · leaf" },
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
      nodeId: "root",
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
