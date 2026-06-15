import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { dryRunMissionScriptSource } from "../src/orchestration/script-validate.ts"
import { simulateOrchestration } from "../src/orchestration/simulate-orchestration.ts"
import { compileOrchestrationPlan } from "../src/orchestration/plan-compile.ts"
import { parseMissionScriptSource } from "../src/orchestration/script-parse.ts"

const smokeFixture = path.join(import.meta.dir, "fixtures/core-example-smoke-v1/mission.script.ts")

describe("orchestration simulation dry-run", () => {
  test("smoke fixture completes simulation with all nodes done", async () => {
    const source = readFileSync(smokeFixture, "utf8")
    const result = await dryRunMissionScriptSource(source, "core-example-smoke-v1")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.length).toBe(0)
  })

  test("simulation rejects orchestrate that leaves nodes pending", async () => {
    const source = `
export const team = {
  mission_id: "sim-m1",
  root: "root",
  nodes: {
    root: { parent: null, description: "root" },
    leaf: { parent: "root", description: "leaf" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.setBrief("leaf", { your_work: ["w"], acceptance_slice: ["done"] })
  await ctx.prompt("leaf", { text: "go", reply: true })
  await ctx.waitFor("leaf", "complete")
}
`
    const result = await dryRunMissionScriptSource(source, "sim-m1")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_SIMULATION_INCOMPLETE")
    expect(result.message).toContain("root")
  })

  test("simulation rejects waitFor without prior prompt on dynamic path", async () => {
    const source = `
export const team = {
  mission_id: "sim-m1",
  root: "root",
  nodes: {
    root: { parent: null, description: "root" },
    leaf: { parent: "root", description: "leaf" },
  },
}
export default async function orchestrate(ctx) {
  const target = "leaf"
  await ctx.setBrief(target, { your_work: ["w"], acceptance_slice: ["done"] })
  await ctx.waitFor(target, "complete")
  await ctx.setBrief("root", { your_work: ["r"], acceptance_slice: ["done"] })
  await ctx.prompt("root", { text: "go", reply: true })
  await ctx.waitFor("root", "complete")
}
`
    const parsed = parseMissionScriptSource(source, "sim-m1")
    const plan = compileOrchestrationPlan({
      missionId: parsed.team.mission_id,
      team: parsed.team,
      orchestrateSource: parsed.orchestrateSource!,
      scriptHash: parsed.scriptHash,
    })
    const result = await simulateOrchestration({ parsed, plan })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_SIMULATION_UNPROMPTED_WAIT")
    expect(result.message).toContain("leaf")
  })

  test("simulation completes parallel siblings when root is orchestrated", async () => {
    const source = `
export const team = {
  mission_id: "sim-m1",
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
    const result = await dryRunMissionScriptSource(source, "sim-m1")
    expect(result.ok).toBe(true)
  })

  test("simulation warns when meta.phases titles are never called", async () => {
    const source = `
export const team = {
  mission_id: "sim-m1",
  root: "a",
  nodes: { a: { parent: null, description: "a" } },
}
export const meta = { phases: ["阶段一", "阶段二"] }
export default async function orchestrate(ctx) {
  ctx.phase("阶段一")
  await ctx.setBrief("a", { your_work: ["w"], acceptance_slice: ["done"] })
  await ctx.prompt("a", { text: "go", reply: true })
  await ctx.waitFor("a", "complete")
}
`
    const result = await dryRunMissionScriptSource(source, "sim-m1")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.some((w) => w.includes("阶段二"))).toBe(true)
  })
})
