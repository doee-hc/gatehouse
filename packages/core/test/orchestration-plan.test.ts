import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { dryRunMissionScriptSource } from "../src/orchestration/script/validate.ts"
import { splitOrchestrateStatements } from "../src/orchestration/plan/compile.ts"
import {
  captureOrchestrationBaseline,
  resetOrchestrationForContinuation,
} from "../src/orchestration/state/baseline.ts"
import { initOrchestrationState } from "../src/orchestration/state/store.ts"

const smokeFixture = path.join(import.meta.dir, "fixtures/core-example-smoke-v1/mission.script.ts")

describe("orchestration plan compile", () => {
  test("smoke fixture compiles plan with run steps", async () => {
    const source = readFileSync(smokeFixture, "utf8")
    const dryRun = await dryRunMissionScriptSource(source, "core-example-smoke-v1")
    expect(dryRun.ok).toBe(true)
    if (!dryRun.ok) return
    expect(dryRun.plan.steps.length).toBe(2)
    expect(dryRun.plan.steps.every((step) => step.op === "run")).toBe(true)
    expect(dryRun.plan.steps.some((step) => step.nodeId === "node-doc")).toBe(true)
    expect(dryRun.plan.steps.some((step) => step.nodeId === "node-root")).toBe(true)
    expect(dryRun.plan.plan_version.length).toBe(16)
  })

  test("warns on multi-round run for same node", async () => {
    const source = `
export const team = {
  mission_id: "plan-m1",
  terminal: "a",
  nodes: { a: { description: "a" } },
}
export default async function orchestrate(ctx) {
  await ctx.run("a", { brief: { your_work: ["1"], acceptance_slice: ["done"] }, text: "wave1" })
  await ctx.run("a", { brief: { your_work: ["2"], acceptance_slice: ["done"] }, text: "wave2" })
}
`
    const result = await dryRunMissionScriptSource(source, "plan-m1")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.some((w) => w.includes("a"))).toBe(true)
    expect(result.plan.steps.filter((s) => s.op === "run" && s.nodeId === "a").length).toBe(2)
  })

  test("rejects unreachable team node", async () => {
    const source = `
export const team = {
  mission_id: "plan-m1",
  terminal: "terminal",
  nodes: {
    terminal: { description: "root" },
    orphan: { description: "orphan" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.run("terminal", { brief: { your_work: ["w"], acceptance_slice: ["done"] }, text: "go" })
}
`
    const result = await dryRunMissionScriptSource(source, "plan-m1")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_SIMULATION_INCOMPLETE")
  })

  test("splitOrchestrateStatements splits top-level run steps", () => {
    const body = `
await ctx.run("a", { brief: { your_work: ["w"], acceptance_slice: ["done"] }, text: "go" })
await ctx.run("b", { brief: { your_work: ["w"], acceptance_slice: ["done"] }, text: "go" })
`
    const statements = splitOrchestrateStatements(body)
    expect(statements.length).toBe(2)
    expect(statements[0]).toContain('ctx.run("a"')
    expect(statements[1]).toContain('ctx.run("b"')
  })

  test("baseline capture preserves done nodes for continuation", () => {
    const state = initOrchestrationState("plan-m1", ["root", "a", "b"])
    state.nodes.a = {
      status: "done",
      completed_at: new Date().toISOString(),
      completion: { summary: "done a", completed_at: new Date().toISOString() },
    }
    state.nodes.b = { status: "running" }
    const baseline = captureOrchestrationBaseline({ missionId: "plan-m1", state })
    expect(baseline.nodes.map((n) => n.node_id)).toEqual(["a"])
    resetOrchestrationForContinuation(state, baseline)
    expect(state.nodes.a?.status).toBe("done")
    expect(state.nodes.b?.status).toBe("pending")
    expect(state.cursor_step_index).toBe(0)
  })

  test("parallel siblings compile with parallel", async () => {
    const source = `
export const team = {
  mission_id: "plan-m1",
  terminal: "terminal",
  nodes: {
    terminal: { description: "root" },
    a: { description: "a" },
    b: { description: "b" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.parallel([
    async () => {
      await ctx.run("a", {
        brief: { your_work: ["a"], acceptance_slice: ["done"] },
        text: "go",
      })
    },
    async () => {
      await ctx.run("b", {
        brief: { your_work: ["b"], acceptance_slice: ["done"] },
        text: "go",
      })
    },
  ])
  await ctx.run("terminal", {
    brief: { your_work: ["summary"], acceptance_slice: ["done"] },
    text: "summary",
    dependsOn: [{ node: "a", deliverable: true }, { node: "b", deliverable: true }],
  })
}
`
    const dryRun = await dryRunMissionScriptSource(source, "plan-m1")
    expect(dryRun.ok).toBe(true)
    if (!dryRun.ok) return
    expect(dryRun.plan.steps.filter((s) => s.op === "run").length).toBe(1)
    expect(dryRun.plan.steps.some((s) => s.op === "parallel")).toBe(true)
  })

  test("parallel tracks compile and simulate independently", async () => {
    const source = `
export const team = {
  mission_id: "plan-m1",
  terminal: "terminal",
  nodes: {
    terminal: { description: "root" },
    a: { description: "track a synthesis" },
    b: { description: "track b synthesis" },
    a1: { description: "a1" },
    a2: { description: "a2" },
    b1: { description: "b1" },
    b2: { description: "b2" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.parallel([
    async () => {
      for (const id of ["a1", "a2"]) {
        await ctx.run(id, { brief: { your_work: [id], acceptance_slice: ["done"] }, text: "go" })
      }
      await ctx.run("a", { brief: { your_work: ["synthesize a"], acceptance_slice: ["done"] }, text: "summary", dependsOn: [{ node: "a1", deliverable: true }, { node: "a2", deliverable: true }] })
    },
    async () => {
      for (const id of ["b1", "b2"]) {
        await ctx.run(id, { brief: { your_work: [id], acceptance_slice: ["done"] }, text: "go" })
      }
      await ctx.run("b", { brief: { your_work: ["synthesize b"], acceptance_slice: ["done"] }, text: "summary", dependsOn: [{ node: "b1", deliverable: true }, { node: "b2", deliverable: true }] })
    },
  ])
  await ctx.run("terminal", { brief: { your_work: ["final"], acceptance_slice: ["done"] }, text: "final", dependsOn: [{ node: "a", deliverable: true }, { node: "b", deliverable: true }] })
}
`
    const dryRun = await dryRunMissionScriptSource(source, "plan-m1")
    expect(dryRun.ok).toBe(true)
    if (!dryRun.ok) return
    expect(dryRun.plan.steps.some((s) => s.op === "parallel")).toBe(true)
  })

  test("splitOrchestrateStatements keeps parallel body as one step", () => {
    const body = `
await ctx.parallel([
  async () => {
    await ctx.run("a1", { brief: { your_work: ["a1"], acceptance_slice: ["done"] }, text: "go" })
  },
])
await ctx.run("terminal", { brief: { your_work: ["root"], acceptance_slice: ["done"] }, text: "final" })
`
    const statements = splitOrchestrateStatements(body)
    expect(statements.length).toBe(2)
    expect(statements[0]).toContain("ctx.parallel")
    expect(statements[0]).toContain('ctx.run("a1"')
    expect(statements[1]).toContain('ctx.run("terminal"')
  })

  test("allows // comments between orchestrate steps after plan-step trim", async () => {
    const source = `
export const team = {
  mission_id: "plan-m1",
  terminal: "a",
  nodes: { a: { description: "a" } },
}
export default async function orchestrate(ctx) {
  // section divider
  await ctx.run("a", { brief: { your_work: ["w"], acceptance_slice: ["done"] }, text: "go" })
}
`
    const result = await dryRunMissionScriptSource(source, "plan-m1")
    expect(result.ok).toBe(true)
  })

  test("plan replay includes orchestrate preamble for local const references", async () => {
    const source = `
export const team = {
  mission_id: "plan-m1",
  terminal: "a",
  nodes: { a: { description: "a" } },
}
export default async function orchestrate(ctx) {
  const OUTPUT_SCHEMA = { type: "object", properties: { ok: { type: "boolean" } } }
  await ctx.run("a", {
    brief: { your_work: ["w"], acceptance_slice: ["done"], completion_schema: OUTPUT_SCHEMA },
    text: "go",
  })
}
`
    const result = await dryRunMissionScriptSource(source, "plan-m1")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.steps[0]?.statement).toContain("const OUTPUT_SCHEMA")
    expect(result.plan.steps[0]?.statement).toContain("completion_schema: OUTPUT_SCHEMA")
  })
})
