import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { formatMissionContractBlock } from "../src/missions/contract-format.ts"
import { formatMissionStartedMessage, enrichLeadDeliveryMessage } from "../src/messaging/delivery-notify.ts"
import { loadCuratorSkillAssignKickoff } from "../src/curator/prompt.ts"
import { loadWatchdogRootWakePrompt } from "../src/watchdog/prompt.ts"
import { loadRetroKickoffPrompt } from "../src/retro/prompt.ts"
import {
  formatCoordinatorSubtreeSnapshot,
  formatTeamSpecAssignmentSummary,
} from "../src/dispatch/team-snapshot.ts"
import { formatRetroKickoffContext } from "../src/retro/subtree-context.ts"
import { formatSkillDomainsRegistry } from "../src/skills/domains.ts"
import { parseTeamSpec, parseTreeManifest } from "../src/tree/parse.ts"
import { copyExampleMission } from "./copy-example-mission.ts"

const scaffoldScript = path.join(import.meta.dir, "../script/scaffold.ts")

const teamSpecYaml = `
mission_id: core-example-smoke-v1
root: node-root
nodes:
  node-root:
    parent: null
    description: 任务协调者
    constraints: |
      协调 node-doc
  node-doc:
    parent: node-root
    description: 文档执行成员
    constraints: |
      写 README
`

describe("prompt snapshot injections", () => {
  test("formatMissionStartedMessage embeds contract block", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-mission-started-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      await copyExampleMission(dir)
      const message = formatMissionStartedMessage(dir, {
        missionId: "core-example-smoke-v1",
        leadName: "Lead",
      })
      expect(message).toContain("packages/core")
      expect(message).toContain("done_when")
      expect(message).not.toContain("gatehouse_mission_current** 获取任务全文")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("loadCuratorSkillAssignKickoff renders injected sections", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-curator-kickoff-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      await copyExampleMission(dir)
      const spec = parseTeamSpec(teamSpecYaml)
      const prompt = await loadCuratorSkillAssignKickoff(dir, {
        missionId: "core-example-smoke-v1",
        spec,
      })
      expect(prompt).toContain("任务快照")
      expect(prompt).toContain("node-doc")
      expect(prompt).toContain("TeamSpec")
      expect(prompt).not.toContain("{{mission_contract}}")
      expect(prompt).not.toContain("gatehouse_mission_current` — 任务全文")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("loadWatchdogRootWakePrompt injects team snapshot and non-root ids", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-watchdog-snap-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      const manifest = parseTreeManifest(`
mission_id: m1
status: running
root_node: node-root
created_at: "2026-01-01T00:00:00.000Z"
nodes:
  node-root:
    session_id: s1
    parent: null
    description: root
  node-doc:
    session_id: s2
    parent: node-root
    description: doc
`)
      const prompt = await loadWatchdogRootWakePrompt(dir, "m1", 12, manifest)
      expect(prompt).toContain("node-doc")
      expect(prompt).toContain("node-root")
      expect(prompt).not.toContain("{{team_execution_snapshot}}")
      expect(prompt).not.toContain("先 `gatehouse_list_team()`")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("loadRetroKickoffPrompt injects retro context snapshot", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-retro-kickoff-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      const missionId = "retro-m1"
      const contextRoot = path.join(dir, ".gatehouse", "trees", missionId, "context")
      await mkdir(contextRoot, { recursive: true })
      await writeFile(
        path.join(contextRoot, "subtree-metrics.json"),
        JSON.stringify({
          mission_id: missionId,
          retro_order: ["node-root"],
          retro_nodes: {
            "node-root": {
              root_node_id: "node-root",
              scope: "subtree",
              node_ids: ["node-root", "node-doc"],
              session_count: 2,
              assistant_messages: 5,
              tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 }, total: 3 },
              cost: 0,
              tools: { total: 4, completed: 3, errors: 1, running: 0, pending: 0, by_name: {} },
            },
          },
        }),
      )
      const manifest = parseTreeManifest(`
mission_id: ${missionId}
status: running
root_node: node-root
created_at: "2026-01-01T00:00:00.000Z"
nodes:
  node-root:
    session_id: s1
    parent: null
  node-doc:
    session_id: s2
    parent: node-root
`)
      const prompt = await loadRetroKickoffPrompt(dir, {
        missionId,
        nodeId: "node-root",
        manifest,
      })
      expect(prompt).toContain("node-doc")
      expect(prompt).toContain("tokens_total=3")
      expect(prompt).not.toContain("{{retro_context_snapshot}}")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("enrichLeadDeliveryMessage appends done_when checklist for structural root → lead", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-lead-delivery-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      await copyExampleMission(dir)
      const message = enrichLeadDeliveryMessage(dir, {
        sender: {
          agentId: "inner:core-example-smoke-v1:node-root",
          sessionId: "s-root",
          profile: "build-coordinator",
          scope: "inner",
          missionId: "core-example-smoke-v1",
          nodeId: "node-root",
          displayName: "root",
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        recipient: {
          agentId: "outer:lead",
          sessionId: "s-lead",
          profile: "lead",
          scope: "outer",
          displayName: "Lead",
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        message: "任务已完成",
      })
      expect(message).toContain("任务已完成")
      expect(message).toContain("验收条件")
      expect(message).toContain("packages/core")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("formatCoordinatorSubtreeSnapshot covers coordinator branch", () => {
    const spec = parseTeamSpec(teamSpecYaml)
    const snapshot = formatCoordinatorSubtreeSnapshot(spec, "node-root", "zh")
    expect(snapshot).toContain("node-root")
    expect(snapshot).toContain("node-doc")
  })

  test("formatTeamSpecAssignmentSummary includes constraint preview", () => {
    const spec = parseTeamSpec(teamSpecYaml)
    const summary = formatTeamSpecAssignmentSummary(spec, "zh")
    expect(summary).toContain("协调 node-doc")
  })

  test("formatSkillDomainsRegistry handles empty registry", () => {
    expect(formatSkillDomainsRegistry([], "zh")).toContain("尚无条目")
  })

  test("formatMissionContractBlock renders notes when present", () => {
    const block = formatMissionContractBlock(
      {
        mission_id: "m1",
        status: "running",
        objective: "obj",
        done_when: ["a"],
        must_not: ["b"],
        notes: "note line",
        locked_at: "t",
        is_active: true,
      },
      "zh",
    )
    expect(block).toContain("note line")
  })

  test("formatRetroKickoffContext without metrics still lists scope", () => {
    const text = formatRetroKickoffContext({
      missionId: "m1",
      nodeId: "node-root",
      retroOrder: ["node-root"],
      locale: "zh",
    })
    expect(text).toContain("node-root")
  })
})
