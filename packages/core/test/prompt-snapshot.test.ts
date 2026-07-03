import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { formatMissionContractBlock } from "../src/missions/contract-format.ts"
import { formatLeadDeliveryNotification } from "../src/delivery/notify.ts"
import {
  enrichLeadDeliveryMessage,
  formatMissionStartedMessage,
  leadDeliveryMessageAlreadyEnriched,
} from "../src/messaging/delivery-notify.ts"
import { loadCuratorSkillAssignKickoff } from "../src/curator/prompt.ts"
import { loadWatchdogNodeWakePrompt } from "../src/watchdog/prompt.ts"
import { loadRetroKickoffPrompt } from "../src/retro/prompt.ts"
import {
  formatAcceptanceSubtreeSnapshot,
  formatTeamSpecAssignmentSummary,
} from "../src/dispatch/team-snapshot.ts"
import { retroAnalysisNodeOrder } from "../src/retro/analysis-order.ts"
import { formatSkillDomainsRegistry } from "../src/skills/domains.ts"
import { parseTeamSpec, parseTreeManifest } from "../src/tree/parse.ts"
import type { OrchestrationPlan } from "../src/orchestration/plan-types.ts"
import { copyExampleMission } from "./copy-example-mission.ts"
import { seedTerminalPlan } from "./seed-terminal-plan.ts"

const scaffoldScript = path.join(import.meta.dir, "../script/scaffold.ts")

const teamSpecYaml = `
mission_id: core-example-smoke-v1
root: node-root
nodes:
  node-root:
    description: Mission 汇总节点，汇总验收 node-doc 交付并向上汇报
  node-doc:
    description: 文档执行成员
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
      expect(message).not.toContain("gatehouse_mission_info** 获取任务全文")
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
      expect(prompt).toContain("冻结")
      expect(prompt).not.toMatch(/## 任务快照\n\n## 任务快照/)
      expect(prompt).toContain("node-doc")
      expect(prompt).toContain("user_skill")
      expect(prompt).not.toContain("{{mission_contract}}")
      expect(prompt).not.toContain("gatehouse_mission_info` — 任务全文")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("loadWatchdogNodeWakePrompt injects node context", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-watchdog-snap-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      const prompt = await loadWatchdogNodeWakePrompt(dir, {
        missionId: "m1",
        nodeId: "node-doc",
        idleSeconds: 12,
      })
      expect(prompt).toContain("node-doc")
      expect(prompt).toContain("m1")
      expect(prompt).toContain("gatehouse_execution_complete")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("loadRetroKickoffPrompt injects orchestration analysis order", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-retro-kickoff-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      const missionId = "retro-m1"
      const manifest = parseTreeManifest(`
mission_id: ${missionId}
status: running
terminal_node: node-root
created_at: "2026-01-01T00:00:00.000Z"
nodes:
  node-root:
    session_id: s1
  node-doc:
    session_id: s2
`)
      const prompt = await loadRetroKickoffPrompt(dir, {
        missionId,
        manifest,
        plan: {
          schema_version: 1,
          mission_id: missionId,
          plan_version: "v1",
          script_hash: "abc",
          warnings: [],
          steps: [
            { id: "step-0", op: "run", nodeId: "node-doc", statement: 'await ctx.run("node-doc", {})' },
            { id: "step-1", op: "run", nodeId: "node-root", statement: 'await ctx.run("node-root", {})' },
          ],
        },
      })
      expect(prompt).toContain("node-doc")
      expect(prompt).toContain("node-root")
      expect(prompt).not.toContain("{{retro_context_snapshot}}")
      expect(prompt).toContain(".gatehouse/trees/retro-m1/context/")
      expect(prompt).toContain("retro-summary.md")
      expect(prompt).toContain("编排脚本顺序")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("leadDeliveryMessageAlreadyEnriched detects formatted delivery submit body", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-lead-enriched-"))
    try {
      seedTerminalPlan(dir, "m1", "root")
      const formatted = formatLeadDeliveryNotification(dir, {
      missionId: "m1",
      record: {
        version: 1,
        status: "submitted",
        submitted_at: "2026-01-01T00:00:00.000Z",
        submitted_by_node: "root",
        criteria: [],
        evidence: [],
        precheck: [],
      },
      contract: {
        mission_id: "m1",
        status: "running",
        objective: "goal",
        done_when: ["file exists"],
        must_not: [],
        locked_at: "2026-01-01T00:00:00.000Z",
        is_active: true,
      },
    })
    expect(leadDeliveryMessageAlreadyEnriched(formatted)).toBe(true)
    expect(
      enrichLeadDeliveryMessage(dir, {
        sender: {
          agentId: "inner:m1:root",
          sessionId: "s-root",
          profile: "build",
          scope: "inner",
          missionId: "m1",
          nodeId: "terminal",
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
        message: formatted,
      }),
    ).toBe(formatted)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("enrichLeadDeliveryMessage appends done_when checklist for terminal node → lead", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-lead-delivery-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      await copyExampleMission(dir)
      seedTerminalPlan(dir, "core-example-smoke-v1", "node-root")
      const message = enrichLeadDeliveryMessage(dir, {
        sender: {
          agentId: "inner:core-example-smoke-v1:node-root",
          sessionId: "s-root",
          profile: "build",
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

  test("formatAcceptanceSubtreeSnapshot covers rollup node branch", () => {
    const spec = parseTeamSpec(teamSpecYaml)
    const plan: OrchestrationPlan = {
      schema_version: 1,
      mission_id: "core-example-smoke-v1",
      plan_version: "v1",
      script_hash: "hash",
      warnings: [],
      steps: [
        { id: "step-0", op: "run", statement: 'await ctx.run("node-doc", { text: "go" })', nodeId: "node-doc" },
        {
          id: "step-1",
          op: "run",
          statement: 'await ctx.run("node-root", { text: "summary", dependsOn: [{ node: "node-doc", summary: true }] })',
          nodeId: "node-root",
        },
      ],
    }
    const snapshot = formatAcceptanceSubtreeSnapshot(spec, plan, "node-root", "zh")
    expect(snapshot).toContain("node-root")
    expect(snapshot).toContain("node-doc")
    expect(snapshot).toContain("子树快照")
  })

  test("formatTeamSpecAssignmentSummary lists node descriptions", () => {
    const spec = parseTeamSpec(teamSpecYaml)
    const summary = formatTeamSpecAssignmentSummary(spec, "zh")
    expect(summary).toContain("Mission 汇总节点，汇总验收 node-doc 交付并向上汇报")
    expect(summary).toContain("文档执行成员")
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

  test("retroAnalysisNodeOrder deduplicates nodes across steps", () => {
    const order = retroAnalysisNodeOrder({
      schema_version: 1,
      mission_id: "m1",
      plan_version: "v1",
      script_hash: "abc",
      warnings: [],
      steps: [
        { id: "step-0", op: "run", nodeId: "node-doc", statement: 'await ctx.run("node-doc", {})' },
        { id: "step-1", op: "run", nodeId: "node-root", statement: 'await ctx.run("node-root", {})' },
      ],
    })
    expect(order).toEqual(["node-doc", "node-root"])
  })
})
