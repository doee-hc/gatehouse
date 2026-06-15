import { describe, expect, test } from "bun:test"
import { lintOrchestrationScript, missionTrackForNode } from "../src/orchestration/orchestration-lint.ts"
import { dryRunMissionScriptSource } from "../src/orchestration/script-validate.ts"

const dualTrackTeam = `
export const team = {
  mission_id: "lint-m1",
  root: "root",
  nodes: {
    root: { parent: null, description: "root" },
    a: { parent: "root", description: "a coord" },
    b: { parent: "root", description: "b coord" },
    a1: { parent: "a", description: "a1" },
    b1: { parent: "b", description: "b1" },
  },
}
`

describe("orchestration lint", () => {
  test("missionTrackForNode maps leaves to root child track", () => {
    const team = {
      mission_id: "m1",
      root: "root",
      nodes: {
        root: { parent: null, description: "root" },
        a: { parent: "root", description: "a" },
        a1: { parent: "a", description: "a1" },
      },
    }
    expect(missionTrackForNode(team, "a1")).toBe("a")
    expect(missionTrackForNode(team, "root")).toBe(null)
  })

  test("rejects serial cross-track blocking at top level", async () => {
    const source = `${dualTrackTeam}
export default async function orchestrate(ctx) {
  await ctx.setBrief("a1", { your_work: ["a1"], acceptance_slice: ["done"] })
  await ctx.setBrief("b1", { your_work: ["b1"], acceptance_slice: ["done"] })
  await ctx.prompt("a1", { text: "go", reply: true })
  await ctx.waitFor("a1", "complete")
  await ctx.prompt("b1", { text: "go", reply: true })
  await ctx.waitFor("b1", "complete")
  await ctx.setBrief("a", { your_work: ["a"], acceptance_slice: ["done"] })
  await ctx.setBrief("b", { your_work: ["b"], acceptance_slice: ["done"] })
  await ctx.prompt("a", { text: "rollup", reply: true, rollupFrom: ["a1"] })
  await ctx.prompt("b", { text: "rollup", reply: true, rollupFrom: ["b1"] })
  await ctx.waitFor("a", "complete")
  await ctx.waitFor("b", "complete")
  await ctx.setBrief("root", { your_work: ["root"], acceptance_slice: ["done"] })
  await ctx.prompt("root", { text: "final", reply: true, rollupFrom: ["a", "b"] })
  await ctx.waitFor("root", "complete")
}
`
    const result = await dryRunMissionScriptSource(source, "lint-m1")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_SERIAL_TRACK_BLOCK")
    expect(result.message).toContain("b1")
  })

  test("allows serial cross-track flow inside ctx.parallel", async () => {
    const source = `${dualTrackTeam}
export default async function orchestrate(ctx) {
  await ctx.parallel([
    async () => {
      await ctx.setBrief("a1", { your_work: ["a1"], acceptance_slice: ["done"] })
      await ctx.prompt("a1", { text: "go", reply: true })
      await ctx.waitFor("a1", "complete")
      await ctx.setBrief("a", { your_work: ["a"], acceptance_slice: ["done"] })
      await ctx.prompt("a", { text: "rollup", reply: true, rollupFrom: ["a1"] })
      await ctx.waitFor("a", "complete")
    },
    async () => {
      await ctx.setBrief("b1", { your_work: ["b1"], acceptance_slice: ["done"] })
      await ctx.prompt("b1", { text: "go", reply: true })
      await ctx.waitFor("b1", "complete")
      await ctx.setBrief("b", { your_work: ["b"], acceptance_slice: ["done"] })
      await ctx.prompt("b", { text: "rollup", reply: true, rollupFrom: ["b1"] })
      await ctx.waitFor("b", "complete")
    },
  ])
  await ctx.setBrief("root", { your_work: ["root"], acceptance_slice: ["done"] })
  await ctx.prompt("root", { text: "final", reply: true, rollupFrom: ["a", "b"] })
  await ctx.waitFor("root", "complete")
}
`
    const result = await dryRunMissionScriptSource(source, "lint-m1")
    expect(result.ok).toBe(true)
  })

  test("rejects pipeline items without setBrief", async () => {
    const source = `
export const team = {
  mission_id: "lint-m1",
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
      await ctx.prompt(nodeId, { text: "go", reply: true })
      return nodeId
    },
    async (nodeId) => {
      await ctx.waitFor(nodeId, "complete")
      return nodeId
    },
  )
  await ctx.setBrief("root", { your_work: ["root"], acceptance_slice: ["done"] })
  await ctx.prompt("root", { text: "rollup", reply: true, rollupFrom: ["a", "b"] })
  await ctx.waitFor("root", "complete")
}
`
    const result = await dryRunMissionScriptSource(source, "lint-m1")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_MISSING_BRIEF")
  })

  test("rejects invalid rollupFrom subtree", () => {
    const team = {
      mission_id: "lint-m1",
      root: "root",
      nodes: {
        root: { parent: null, description: "root" },
        a: { parent: "root", description: "a" },
        b: { parent: "root", description: "b" },
      },
    }
    const lint = lintOrchestrationScript(
      team,
      `
await ctx.setBrief("a", { your_work: ["a"], acceptance_slice: ["done"] })
await ctx.prompt("a", { text: "rollup", reply: true, rollupFrom: ["b"] })
await ctx.waitFor("a", "complete")
`,
    )
    expect(lint.errors.some((e) => e.code === "SCRIPT_INVALID_ROLLUP")).toBe(true)
  })

  test("warns when sibling tracks lack ctx.parallel", () => {
    const team = {
      mission_id: "lint-m1",
      root: "root",
      nodes: {
        root: { parent: null, description: "root" },
        a: { parent: "root", description: "a" },
        b: { parent: "root", description: "b" },
      },
    }
    const lint = lintOrchestrationScript(
      team,
      `
await ctx.setBrief("a", { your_work: ["a"], acceptance_slice: ["done"] })
await ctx.setBrief("b", { your_work: ["b"], acceptance_slice: ["done"] })
await ctx.prompt("a", { text: "go", reply: true })
await ctx.prompt("b", { text: "go", reply: true })
await ctx.waitFor("a", "complete")
await ctx.waitFor("b", "complete")
`,
    )
    expect(lint.warnings.some((w) => w.includes("ctx.parallel"))).toBe(true)
  })
})
