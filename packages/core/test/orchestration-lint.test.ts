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
  await ctx.run("a1", { brief: { your_work: ["a1"], acceptance_slice: ["done"] }, text: "go" })
  await ctx.run("b1", { brief: { your_work: ["b1"], acceptance_slice: ["done"] }, text: "go" })
  await ctx.run("a", { brief: { your_work: ["a"], acceptance_slice: ["done"] }, text: "rollup", dependsOn: [{ node: "a1", summary: true }] })
  await ctx.run("b", { brief: { your_work: ["b"], acceptance_slice: ["done"] }, text: "rollup", dependsOn: [{ node: "b1", summary: true }] })
  await ctx.run("root", { brief: { your_work: ["root"], acceptance_slice: ["done"] }, text: "final", dependsOn: [{ node: "a", summary: true }, { node: "b", summary: true }] })
}
`
    const result = await dryRunMissionScriptSource(source, "lint-m1")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_SERIAL_TRACK_BLOCK")
    expect(result.message).toContain("b1")
  })

  test("allows serial cross-track flow inside ctx.fork", async () => {
    const source = `${dualTrackTeam}
export default async function orchestrate(ctx) {
  await ctx.fork([
    async () => {
      await ctx.run("a1", { brief: { your_work: ["a1"], acceptance_slice: ["done"] }, text: "go" })
      await ctx.run("a", { brief: { your_work: ["a"], acceptance_slice: ["done"] }, text: "rollup", dependsOn: [{ node: "a1", summary: true }] })
    },
    async () => {
      await ctx.run("b1", { brief: { your_work: ["b1"], acceptance_slice: ["done"] }, text: "go" })
      await ctx.run("b", { brief: { your_work: ["b"], acceptance_slice: ["done"] }, text: "rollup", dependsOn: [{ node: "b1", summary: true }] })
    },
  ])
  await ctx.run("root", { brief: { your_work: ["root"], acceptance_slice: ["done"] }, text: "final", dependsOn: [{ node: "a", summary: true }, { node: "b", summary: true }] })
}
`
    const result = await dryRunMissionScriptSource(source, "lint-m1")
    expect(result.ok).toBe(true)
  })

  test("rejects run dispatch without brief", async () => {
    const source = `
export const team = {
  mission_id: "lint-m1",
  root: "root",
  nodes: {
    root: { parent: null, description: "root" },
    a: { parent: "root", description: "a" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.run("a", { text: "go" })
  await ctx.run("root", { brief: { your_work: ["root"], acceptance_slice: ["done"] }, text: "rollup", dependsOn: [{ node: "a", summary: true }] })
}
`
    const result = await dryRunMissionScriptSource(source, "lint-m1")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_MISSING_BRIEF")
  })

  test("warns on cross-subtree dependsOn summary without blocking", () => {
    const team = {
      mission_id: "lint-m1",
      root: "root",
      nodes: {
        root: { parent: null, description: "root" },
        a: { parent: "root", description: "a" },
        b: { parent: "root", description: "b" },
      },
    }
    const crossRollup = lintOrchestrationScript(
      team,
      `
await ctx.run("a", { brief: { your_work: ["a"], acceptance_slice: ["done"] }, text: "go", dependsOn: [{ node: "b", summary: true }] })
`,
    )
    expect(crossRollup.errors.some((e) => e.code === "SCRIPT_UNKNOWN_NODE")).toBe(false)
    expect(crossRollup.warnings.some((w) => w.includes("cross-subtree"))).toBe(false)

    const crossAfter = lintOrchestrationScript(
      team,
      `
await ctx.run("b", { brief: { your_work: ["b"], acceptance_slice: ["done"] }, text: "go", dependsOn: ["a"] })
`,
    )
    expect(crossAfter.errors).toHaveLength(0)
  })

  test("warns when sibling tracks lack ctx.fork", () => {
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
await ctx.run("a", { brief: { your_work: ["a"], acceptance_slice: ["done"] }, text: "go" })
await ctx.run("b", { brief: { your_work: ["b"], acceptance_slice: ["done"] }, text: "go" })
`,
    )
    expect(lint.warnings.some((w) => w.includes("ctx.fork"))).toBe(true)
  })

  test("rejects top-level for loop with ctx.run", async () => {
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
  for (const id of ["a", "b"]) {
    await ctx.run(id, { brief: { your_work: [id], acceptance_slice: ["path: reports/" + id + ".md"] }, text: "go" })
  }
  await ctx.run("root", { brief: { your_work: ["rollup"], acceptance_slice: ["done"] }, text: "rollup", dependsOn: [{ node: "a", summary: true }, { node: "b", summary: true }] })
}
`
    const result = await dryRunMissionScriptSource(source, "lint-m1")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_PLAN_DYNAMIC_TOP_LEVEL")
  })

  test("rejects ctx.readMissionContext in orchestrate", async () => {
    const source = `
export const team = {
  mission_id: "lint-m1",
  root: "a",
  nodes: { a: { parent: null, description: "a" } },
}
export default async function orchestrate(ctx) {
  ctx.readMissionContext()
  await ctx.run("a", { brief: { your_work: ["w"], acceptance_slice: ["done"] }, text: "go" })
}
`
    const result = await dryRunMissionScriptSource(source, "lint-m1")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_FORBIDDEN_CTX_READ")
  })

  test("allows run without text when default work order is configured", async () => {
    const source = `
export const team = {
  mission_id: "lint-m1",
  root: "root",
  nodes: {
    root: { parent: null, description: "root" },
    a: { parent: "root", description: "a" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.run("a", { brief: { your_work: ["w"], acceptance_slice: ["path: reports/a.md"] } })
  await ctx.run("root", { brief: { your_work: ["r"], acceptance_slice: ["done"] }, dependsOn: [{ node: "a", summary: true }] })
}
`
    const result = await dryRunMissionScriptSource(source, "lint-m1")
    expect(result.ok).toBe(true)
  })

  test("warns on leaf acceptance_slice without path", () => {
    const team = {
      mission_id: "lint-m1",
      root: "root",
      nodes: {
        root: { parent: null, description: "root" },
        a: { parent: "root", description: "a" },
      },
    }
    const lint = lintOrchestrationScript(
      team,
      `
await ctx.run("a", { brief: { your_work: ["w"], acceptance_slice: ["done"] }, text: "go" })
await ctx.run("root", { brief: { your_work: ["r"], acceptance_slice: ["done"] }, text: "rollup", dependsOn: [{ node: "a", summary: true }] })
`,
    )
    expect(lint.warnings.some((w) => w.includes("path:"))).toBe(true)
  })

  test("warns on non-literal node id", () => {
    const team = {
      mission_id: "lint-m1",
      root: "root",
      nodes: {
        root: { parent: null, description: "root" },
        a: { parent: "root", description: "a" },
      },
    }
    const lint = lintOrchestrationScript(
      team,
      `
const target = "a"
await ctx.run(target, { brief: { your_work: ["w"], acceptance_slice: ["path: reports/a.md"] }, text: "go" })
await ctx.run("root", { brief: { your_work: ["r"], acceptance_slice: ["done"] }, text: "rollup", dependsOn: [{ node: "a", summary: true }] })
`,
    )
    expect(lint.warnings.some((w) => w.includes("non-literal"))).toBe(true)
  })

  test("warns on ctx.run without await", () => {
    const lint = lintOrchestrationScript(
      {
        mission_id: "lint-m1",
        root: "a",
        nodes: { a: { parent: null, description: "a" } },
      },
      `
ctx.run("a", { brief: { your_work: ["w"], acceptance_slice: ["path: reports/a.md"] }, text: "go" })
`,
    )
    expect(lint.warnings.some((w) => w.includes("await"))).toBe(true)
  })
})
