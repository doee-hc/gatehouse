import { describe, expect, test } from "bun:test"
import { teamNodeOrder } from "../src/orchestration/plan-graph.ts"
import {
  isSoloExecutionTeam,
  manifestMembers,
  modelForInnerNode,
  parseTeamSpec,
  resolveInnerProfile,
  validateTeamSpec,
} from "../src/tree/parse.ts"
import { parseTreeManifest } from "../src/tree/parse.ts"
import { retroAnalysisNodeOrder } from "../src/retro/analysis-order.ts"
import type { OrchestrationPlan } from "../src/orchestration/plan-types.ts"
import { INNER_EXECUTION_AGENT } from "../src/registry/types.ts"

const sampleSpec = `
mission_id: demo-mission
root: root
nodes:
  root:
    description: 任务协调者
  leaf:
    description: 执行成员
`

describe("TeamSpec", () => {
  test("teamNodeOrder puts terminal first without plan", () => {
    const spec = parseTeamSpec(sampleSpec)
    validateTeamSpec(spec)
    expect(spec.terminal).toBe("root")
    expect(teamNodeOrder(spec)).toEqual(["root", "leaf"])
  })

  test("parseTeamSpec rejects node without description", () => {
    let message = ""
    try {
      parseTeamSpec(`
mission_id: demo-mission
root: root
nodes:
  root:
`)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain("Invalid TeamSpec node")
  })

  test("parseTeamSpec rejects deprecated constraints field", () => {
    let message = ""
    try {
      parseTeamSpec(`
mission_id: demo-mission
root: root
nodes:
  root:
    description: 任务协调者
    constraints: "coord"
`)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain("must not include constraints")
  })

  test("validateTeamSpec rejects empty description", () => {
    let message = ""
    try {
      validateTeamSpec(
        parseTeamSpec(`
mission_id: demo-mission
root: root
nodes:
  root:
    description: "   "
`),
      )
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain("description")
  })

  test("parseTreeManifest reads description", () => {
    const manifest = parseTreeManifest(`
mission_id: demo
status: running
root_node: root
created_at: "2026-01-01T00:00:00Z"
nodes:
  root:
    session_id: ses-1
    description: 任务协调者
`)
    expect(manifest.nodes.root?.description).toBe("任务协调者")
  })

  test("manifestMembers includes description", () => {
    const manifest = parseTreeManifest(`
mission_id: demo
status: running
root_node: root
created_at: "2026-01-01T00:00:00Z"
nodes:
  root:
    session_id: ses-1
    description: 协调
  leaf:
    session_id: ses-2
    description: 执行
`)
    const members = manifestMembers(manifest)
    expect(members.find((item) => item.node_id === "root")?.description).toBe("协调")
    expect(members.find((item) => item.node_id === "leaf")?.description).toBe("执行")
  })

  test("resolveInnerProfile always returns build", () => {
    const spec = parseTeamSpec(sampleSpec)
    expect(resolveInnerProfile(spec, "root")).toBe(INNER_EXECUTION_AGENT)
    expect(resolveInnerProfile(spec, "leaf")).toBe(INNER_EXECUTION_AGENT)
    const multi = parseTeamSpec(`
mission_id: multi
root: node-root
nodes:
  node-root:
    description: 根
  node-mid:
    description: 中层
  node-leaf:
    description: 叶
`)
    expect(resolveInnerProfile(multi, "node-mid")).toBe(INNER_EXECUTION_AGENT)
    expect(resolveInnerProfile(multi, "node-leaf")).toBe(INNER_EXECUTION_AGENT)
  })

  test("modelForInnerNode uses rollup targets as coordinator", () => {
    const solo = parseTeamSpec(`
mission_id: solo
root: node-root
nodes:
  node-root:
    description: 单人根节点
`)
    const soloPlan: OrchestrationPlan = {
      schema_version: 1,
      mission_id: "solo",
      plan_version: "v1",
      script_hash: "solo",
      warnings: [],
      steps: [{ id: "step-0", op: "run", nodeId: "node-root", statement: 'await ctx.run("node-root", {})' }],
    }
    expect(modelForInnerNode({ executor: "exec", coordinator: "coord" }, soloPlan, "node-root")).toBe("exec")

    const multi = parseTeamSpec(sampleSpec)
    const multiPlan: OrchestrationPlan = {
      schema_version: 1,
      mission_id: "demo-mission",
      plan_version: "v1",
      script_hash: "multi",
      warnings: [],
      steps: [
        { id: "step-0", op: "run", nodeId: "leaf", statement: 'await ctx.run("leaf", {})' },
        {
          id: "step-1",
          op: "run",
          nodeId: "root",
          statement: 'await ctx.run("root", { dependsOn: [{ node: "leaf", deliverable: true }] })',
        },
      ],
    }
    expect(multi.terminal).toBe("root")
    expect(modelForInnerNode({ executor: "exec", coordinator: "coord" }, multiPlan, "root")).toBe("coord")
    expect(modelForInnerNode({ executor: "exec", coordinator: "coord" }, multiPlan, "leaf")).toBe("exec")
  })

  test("parseTeamSpec rejects profile field on nodes", () => {
    let message = ""
    try {
      parseTeamSpec(`
mission_id: bad
root: root
nodes:
  root:
    description: 根
    profile: build
`)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain("must not include profile")
  })
})

describe("TreeManifest", () => {
  test("parseTreeManifest reads display_name", () => {
    const manifest = parseTreeManifest(`
mission_id: demo
status: running
root_node: root
created_at: "2026-01-01T00:00:00Z"
nodes:
  root:
    session_id: ses-1
    display_name: root
`)
    expect(manifest.nodes.root?.display_name).toBe("root")
  })
})

describe("retro analysis order", () => {
  test("retroAnalysisNodeOrder follows plan run steps", () => {
    const plan: OrchestrationPlan = {
      schema_version: 1,
      mission_id: "demo",
      plan_version: "v1",
      script_hash: "abc",
      warnings: [],
      steps: [
        { id: "step-0", op: "run", nodeId: "leaf", statement: 'await ctx.run("leaf", {})' },
        { id: "step-1", op: "run", nodeId: "root", statement: 'await ctx.run("root", {})' },
      ],
    }
    expect(retroAnalysisNodeOrder(plan)).toEqual(["leaf", "root"])
  })
})

describe("solo execution team", () => {
  test("isSoloExecutionTeam is false for multi-node trees", () => {
    const manifest = parseTreeManifest(`
mission_id: multi
status: running
root_node: root
created_at: "2026-01-01T00:00:00Z"
nodes:
  root:
    session_id: s1
  leaf:
    session_id: s2
`)
    expect(isSoloExecutionTeam(manifest)).toBe(false)
  })
})
