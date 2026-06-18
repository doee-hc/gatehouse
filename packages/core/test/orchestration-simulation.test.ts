import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { dryRunMissionScriptSource } from "../src/orchestration/script-validate.ts"

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
  await ctx.run("leaf", { brief: { your_work: ["w"], acceptance_slice: ["done"] }, text: "go" })
}
`
    const result = await dryRunMissionScriptSource(source, "sim-m1")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_SIMULATION_INCOMPLETE")
    expect(result.message).toContain("root")
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
  await ctx.fork([
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
  await ctx.run("root", {
    brief: { your_work: ["rollup"], acceptance_slice: ["done"] },
    text: "rollup",
    dependsOn: [{ node: "a", summary: true }, { node: "b", summary: true }],
  })
}
`
    const result = await dryRunMissionScriptSource(source, "sim-m1")
    expect(result.ok).toBe(true)
  })
})
