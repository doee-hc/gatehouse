import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { dryRunMissionScriptSource } from "../src/orchestration/script-validate.ts"
import { splitOrchestrateStatements } from "../src/orchestration/plan-compile.ts"
import {
  captureOrchestrationBaseline,
  resetOrchestrationForContinuation,
} from "../src/orchestration/baseline.ts"
import { initOrchestrationState } from "../src/orchestration/state.ts"

const smokeFixture = path.join(import.meta.dir, "fixtures/core-example-smoke-v1/mission.script.ts")

describe("orchestration plan compile", () => {
  test("smoke fixture compiles plan with phase and wait steps", async () => {
    const source = readFileSync(smokeFixture, "utf8")
    const dryRun = await dryRunMissionScriptSource(source, "core-example-smoke-v1")
    expect(dryRun.ok).toBe(true)
    if (!dryRun.ok) return
    expect(dryRun.plan.steps.length).toBeGreaterThanOrEqual(6)
    expect(dryRun.plan.steps.some((step) => step.op === "phase")).toBe(true)
    expect(dryRun.plan.steps.some((step) => step.op === "wait" && step.nodeId === "node-doc")).toBe(true)
    expect(dryRun.plan.plan_version.length).toBe(16)
  })

  test("rejects waitFor before prompt", async () => {
    const source = `
export const team = {
  mission_id: "plan-m1",
  root: "a",
  nodes: {
    a: { parent: null, description: "a" },
    b: { parent: "a", description: "b" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.waitFor("b", "complete")
  await ctx.setBrief("b", { your_work: ["w"], acceptance_slice: ["done"] })
  await ctx.prompt("b", { text: "go", reply: true })
  await ctx.waitFor("b", "complete")
}
`
    const result = await dryRunMissionScriptSource(source, "plan-m1")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_UNPROMPTED_WAIT")
  })

  test("warns on multi-round prompt for same node", async () => {
    const source = `
export const team = {
  mission_id: "plan-m1",
  root: "a",
  nodes: { a: { parent: null, description: "a" } },
}
export default async function orchestrate(ctx) {
  await ctx.setBrief("a", { your_work: ["1"], acceptance_slice: ["done"] })
  await ctx.prompt("a", { text: "wave1", reply: true })
  await ctx.waitFor("a", "complete")
  await ctx.setBrief("a", { your_work: ["2"], acceptance_slice: ["done"] })
  await ctx.prompt("a", { text: "wave2", reply: true })
  await ctx.waitFor("a", "complete")
}
`
    const result = await dryRunMissionScriptSource(source, "plan-m1")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.some((w) => w.includes("a"))).toBe(true)
    expect(result.plan.steps.filter((s) => s.op === "prompt" && s.reply).length).toBe(2)
  })

  test("rejects unreachable team node", async () => {
    const source = `
export const team = {
  mission_id: "plan-m1",
  root: "root",
  nodes: {
    root: { parent: null, description: "root" },
    orphan: { parent: null, description: "orphan" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.setBrief("root", { your_work: ["w"], acceptance_slice: ["done"] })
  await ctx.prompt("root", { text: "go", reply: true })
  await ctx.waitFor("root", "complete")
}
`
    const result = await dryRunMissionScriptSource(source, "plan-m1")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_UNREACHABLE_NODE")
  })

  test("splitOrchestrateStatements captures sync ctx.phase", () => {
    const body = `
ctx.phase("阶段一")
await ctx.setBrief("a", { your_work: ["w"], acceptance_slice: ["done"] })
await ctx.prompt("a", { text: "go", reply: true })
`
    const statements = splitOrchestrateStatements(body)
    expect(statements.length).toBe(3)
    expect(statements[0]).toContain('ctx.phase("阶段一")')
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
    expect(state.completed_step_ids).toEqual([])
  })

  test("parallel prompt then wait compiles for linear team", async () => {
    const source = `
export const team = {
  mission_id: "plan-m1",
  root: "root",
  nodes: {
    root: { parent: null, description: "root" },
    a: { parent: "root", description: "a" },
    b: { parent: "root", description: "b" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.setBrief("a", { your_work: ["a"], acceptance_slice: ["done"] })
  await ctx.setBrief("b", { your_work: ["b"], acceptance_slice: ["done"] })
  await ctx.prompt("a", { text: "go", reply: true })
  await ctx.prompt("b", { text: "go", reply: true })
  await ctx.waitFor("a", "complete")
  await ctx.waitFor("b", "complete")
  await ctx.setBrief("root", { your_work: ["rollup"], acceptance_slice: ["done"] })
  await ctx.prompt("root", { text: "rollup", reply: true, rollupFrom: ["a", "b"] })
  await ctx.waitFor("root", "complete")
}
`
    const dryRun = await dryRunMissionScriptSource(source, "plan-m1")
    expect(dryRun.ok).toBe(true)
    if (!dryRun.ok) return
    expect(dryRun.plan.steps.filter((s) => s.op === "wait").length).toBe(3)
  })

  test("parallel tracks compile and simulate independently", async () => {
    const source = `
export const team = {
  mission_id: "plan-m1",
  root: "root",
  nodes: {
    root: { parent: null, description: "root" },
    a: { parent: "root", description: "a coord" },
    b: { parent: "root", description: "b coord" },
    a1: { parent: "a", description: "a1" },
    a2: { parent: "a", description: "a2" },
    b1: { parent: "b", description: "b1" },
    b2: { parent: "b", description: "b2" },
  },
}
export default async function orchestrate(ctx) {
  ctx.phase("parallel tracks")
  await ctx.parallel([
    async () => {
      for (const id of ["a1", "a2"]) {
        await ctx.setBrief(id, { your_work: [id], acceptance_slice: ["done"] })
        await ctx.prompt(id, { text: "go", reply: true })
      }
      await ctx.waitFor("a1", "complete")
      await ctx.waitFor("a2", "complete")
      await ctx.setBrief("a", { your_work: ["rollup a"], acceptance_slice: ["done"] })
      await ctx.prompt("a", { text: "rollup", reply: true, rollupFrom: ["a1", "a2"] })
      await ctx.waitFor("a", "complete")
    },
    async () => {
      for (const id of ["b1", "b2"]) {
        await ctx.setBrief(id, { your_work: [id], acceptance_slice: ["done"] })
        await ctx.prompt(id, { text: "go", reply: true })
      }
      await ctx.waitFor("b1", "complete")
      await ctx.waitFor("b2", "complete")
      await ctx.setBrief("b", { your_work: ["rollup b"], acceptance_slice: ["done"] })
      await ctx.prompt("b", { text: "rollup", reply: true, rollupFrom: ["b1", "b2"] })
      await ctx.waitFor("b", "complete")
    },
  ])
  await ctx.setBrief("root", { your_work: ["final"], acceptance_slice: ["done"] })
  await ctx.prompt("root", { text: "final", reply: true, rollupFrom: ["a", "b"] })
  await ctx.waitFor("root", "complete")
}
`
    const dryRun = await dryRunMissionScriptSource(source, "plan-m1")
    expect(dryRun.ok).toBe(true)
    if (!dryRun.ok) return
    expect(dryRun.plan.steps.some((s) => s.op === "parallel")).toBe(true)
  })

  test("pipeline compiles as compound plan step", async () => {
    const source = `
export const team = {
  mission_id: "plan-m1",
  root: "root",
  nodes: {
    root: { parent: null, description: "root" },
    a: { parent: "root", description: "a" },
    b: { parent: "root", description: "b" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.pipeline(
    ["a", "b"],
    async (nodeId) => {
      await ctx.setBrief(nodeId, { your_work: [nodeId], acceptance_slice: ["done"] })
      await ctx.prompt(nodeId, { text: "go", reply: true })
      return nodeId
    },
    async (nodeId) => {
      await ctx.waitFor(nodeId, "complete")
      return nodeId
    },
  )
  await ctx.setBrief("root", { your_work: ["rollup"], acceptance_slice: ["done"] })
  await ctx.prompt("root", { text: "rollup", reply: true, rollupFrom: ["a", "b"] })
  await ctx.waitFor("root", "complete")
}
`
    const dryRun = await dryRunMissionScriptSource(source, "plan-m1")
    expect(dryRun.ok).toBe(true)
    if (!dryRun.ok) return
    expect(dryRun.plan.steps.some((s) => s.op === "pipeline")).toBe(true)
  })

  test("splitOrchestrateStatements keeps parallel body as one step", () => {
    const body = `
await ctx.parallel([
  async () => {
    await ctx.setBrief("a1", { your_work: ["a1"], acceptance_slice: ["done"] })
    await ctx.prompt("a1", { text: "go", reply: true })
    await ctx.waitFor("a1", "complete")
  },
])
await ctx.waitFor("root", "complete")
`
    const statements = splitOrchestrateStatements(body)
    expect(statements.length).toBe(2)
    expect(statements[0]).toContain("ctx.parallel")
    expect(statements[0]).toContain('ctx.waitFor("a1"')
    expect(statements[1]).toContain('ctx.waitFor("root"')
  })

  test("allows // comments between orchestrate steps after plan-step trim", async () => {
    const source = `
export const team = {
  mission_id: "plan-m1",
  root: "a",
  nodes: { a: { parent: null, description: "a" } },
}
export default async function orchestrate(ctx) {
  ctx.phase("阶段一")

  // section divider
  await ctx.setBrief("a", { your_work: ["w"], acceptance_slice: ["done"] })
  await ctx.prompt("a", { text: "go", reply: true })
  await ctx.waitFor("a", "complete")
}
`
    const result = await dryRunMissionScriptSource(source, "plan-m1")
    expect(result.ok).toBe(true)
  })
})
