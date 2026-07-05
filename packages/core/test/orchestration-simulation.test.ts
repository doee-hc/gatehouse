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
  terminal: "leaf",
  nodes: {
    leaf: { description: "leaf" },
    orphan: { description: "orphan" },
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
    expect(result.message).toContain("orphan")
  })

  test("simulation completes parallel siblings when root is orchestrated", async () => {
    const source = `
export const team = {
  mission_id: "sim-m1",
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
    const result = await dryRunMissionScriptSource(source, "sim-m1")
    expect(result.ok).toBe(true)
  })
})
