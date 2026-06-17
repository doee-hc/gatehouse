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

  test("rejects join before run", async () => {
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
  await ctx.join("b")
  await ctx.run("b", { brief: { your_work: ["w"], acceptance_slice: ["done"] }, text: "go" })
}
`
    const result = await dryRunMissionScriptSource(source, "plan-m1")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_UNPROMPTED_WAIT")
  })

  test("warns on multi-round run for same node", async () => {
    const source = `
export const team = {
  mission_id: "plan-m1",
  root: "a",
  nodes: { a: { parent: null, description: "a" } },
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
  root: "root",
  nodes: {
    root: { parent: null, description: "root" },
    orphan: { parent: null, description: "orphan" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.run("root", { brief: { your_work: ["w"], acceptance_slice: ["done"] }, text: "go" })
}
`
    const result = await dryRunMissionScriptSource(source, "plan-m1")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_UNREACHABLE_NODE")
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
    expect(state.completed_step_ids).toEqual([])
  })

  test("parallel run fan-out compiles for linear team", async () => {
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
  await ctx.run(["a", "b"], {
    brief: (id) => ({ your_work: [id], acceptance_slice: ["done"] }),
    text: "go",
    wait: false,
  })
  await ctx.join(["a", "b"])
  await ctx.run("root", {
    brief: { your_work: ["rollup"], acceptance_slice: ["done"] },
    text: "rollup",
    rollupFrom: ["a", "b"],
  })
}
`
    const dryRun = await dryRunMissionScriptSource(source, "plan-m1")
    expect(dryRun.ok).toBe(true)
    if (!dryRun.ok) return
    expect(dryRun.plan.steps.filter((s) => s.op === "run").length).toBe(2)
    expect(dryRun.plan.steps.some((s) => s.op === "join")).toBe(true)
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
  await ctx.fork([
    async () => {
      for (const id of ["a1", "a2"]) {
        await ctx.run(id, { brief: { your_work: [id], acceptance_slice: ["done"] }, text: "go" })
      }
      await ctx.run("a", { brief: { your_work: ["rollup a"], acceptance_slice: ["done"] }, text: "rollup", rollupFrom: ["a1", "a2"] })
    },
    async () => {
      for (const id of ["b1", "b2"]) {
        await ctx.run(id, { brief: { your_work: [id], acceptance_slice: ["done"] }, text: "go" })
      }
      await ctx.run("b", { brief: { your_work: ["rollup b"], acceptance_slice: ["done"] }, text: "rollup", rollupFrom: ["b1", "b2"] })
    },
  ])
  await ctx.run("root", { brief: { your_work: ["final"], acceptance_slice: ["done"] }, text: "final", rollupFrom: ["a", "b"] })
}
`
    const dryRun = await dryRunMissionScriptSource(source, "plan-m1")
    expect(dryRun.ok).toBe(true)
    if (!dryRun.ok) return
    expect(dryRun.plan.steps.some((s) => s.op === "fork")).toBe(true)
  })

  test("rejects legacy ctx.pipeline", async () => {
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
      await ctx.run(nodeId, { brief: { your_work: [nodeId], acceptance_slice: ["done"] }, text: "go" })
      return nodeId
    },
    async (nodeId) => {
      await ctx.join(nodeId)
      return nodeId
    },
  )
  await ctx.run("root", { brief: { your_work: ["rollup"], acceptance_slice: ["done"] }, text: "rollup", rollupFrom: ["a", "b"] })
}
`
    const dryRun = await dryRunMissionScriptSource(source, "plan-m1")
    expect(dryRun.ok).toBe(false)
    if (dryRun.ok) return
    expect(dryRun.code).toBe("SCRIPT_LEGACY_API")
  })

  test("splitOrchestrateStatements keeps fork body as one step", () => {
    const body = `
await ctx.fork([
  async () => {
    await ctx.run("a1", { brief: { your_work: ["a1"], acceptance_slice: ["done"] }, text: "go" })
  },
])
await ctx.join("root")
`
    const statements = splitOrchestrateStatements(body)
    expect(statements.length).toBe(2)
    expect(statements[0]).toContain("ctx.fork")
    expect(statements[0]).toContain('ctx.run("a1"')
    expect(statements[1]).toContain('ctx.join("root"')
  })

  test("allows // comments between orchestrate steps after plan-step trim", async () => {
    const source = `
export const team = {
  mission_id: "plan-m1",
  root: "a",
  nodes: { a: { parent: null, description: "a" } },
}
export default async function orchestrate(ctx) {
  // section divider
  await ctx.run("a", { brief: { your_work: ["w"], acceptance_slice: ["done"] }, text: "go" })
}
`
    const result = await dryRunMissionScriptSource(source, "plan-m1")
    expect(result.ok).toBe(true)
  })
})
