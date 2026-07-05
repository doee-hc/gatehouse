import { describe, expect, test } from "bun:test"
import { lintOrchestrationScript } from "../src/orchestration/orchestration-lint.ts"
import { compileOrchestrationPlan } from "../src/orchestration/plan-compile.ts"
import { planTrackForNode } from "../src/orchestration/plan-graph.ts"
import { dryRunMissionScriptSource } from "../src/orchestration/script-validate.ts"

const dualTrackTeam = `
export const team = {
  mission_id: "lint-m1",
  terminal: "terminal",
  nodes: {
    terminal: { description: "root" },
    a: { description: "a coord" },
    b: { description: "b coord" },
    a1: { description: "a1" },
    b1: { description: "b1" },
  },
}
`

describe("orchestration lint", () => {
  test("planTrackForNode maps leaves to track roots", () => {
    const team = {
      mission_id: "m1",
      terminal: "terminal",
      nodes: {
        terminal: { description: "root" },
        a: { description: "a" },
        a1: { description: "a1" },
      },
    }
    const plan = compileOrchestrationPlan({
      missionId: "m1",
      team,
      orchestrateSource: `
await ctx.run("a1", { brief: { your_work: ["a1"], acceptance_slice: ["done"] }, text: "go" })
await ctx.run("a", { brief: { your_work: ["a"], acceptance_slice: ["done"] }, text: "summary", dependsOn: [{ node: "a1", deliverable: true }] })
await ctx.run("terminal", { brief: { your_work: ["root"], acceptance_slice: ["done"] }, text: "final", dependsOn: [{ node: "a", deliverable: true }] })
`,
      scriptHash: "abc",
    })
    expect(planTrackForNode(plan, team, "a1")).toBe("a1")
    expect(planTrackForNode(plan, team, "a")).toBe("a1")
    expect(planTrackForNode(plan, team, "terminal")).toBe(null)
  })

  test("allows serial cross-track blocking at top level under plan-derived tracks", async () => {
    const source = `${dualTrackTeam}
export default async function orchestrate(ctx) {
  await ctx.run("a1", { brief: { your_work: ["a1"], acceptance_slice: ["done"] }, text: "go" })
  await ctx.run("b1", { brief: { your_work: ["b1"], acceptance_slice: ["done"] }, text: "go" })
  await ctx.run("a", { brief: { your_work: ["a"], acceptance_slice: ["done"] }, text: "summary", dependsOn: [{ node: "a1", deliverable: true }] })
  await ctx.run("b", { brief: { your_work: ["b"], acceptance_slice: ["done"] }, text: "summary", dependsOn: [{ node: "b1", deliverable: true }] })
  await ctx.run("terminal", { brief: { your_work: ["root"], acceptance_slice: ["done"] }, text: "final", dependsOn: [{ node: "a", deliverable: true }, { node: "b", deliverable: true }] })
}
`
    const result = await dryRunMissionScriptSource(source, "lint-m1")
    expect(result.ok).toBe(true)
  })

  test("allows serial cross-track flow inside ctx.parallel", async () => {
    const source = `${dualTrackTeam}
export default async function orchestrate(ctx) {
  await ctx.parallel([
    async () => {
      await ctx.run("a1", { brief: { your_work: ["a1"], acceptance_slice: ["done"] }, text: "go" })
      await ctx.run("a", { brief: { your_work: ["a"], acceptance_slice: ["done"] }, text: "summary", dependsOn: [{ node: "a1", deliverable: true }] })
    },
    async () => {
      await ctx.run("b1", { brief: { your_work: ["b1"], acceptance_slice: ["done"] }, text: "go" })
      await ctx.run("b", { brief: { your_work: ["b"], acceptance_slice: ["done"] }, text: "summary", dependsOn: [{ node: "b1", deliverable: true }] })
    },
  ])
  await ctx.run("terminal", { brief: { your_work: ["root"], acceptance_slice: ["done"] }, text: "final", dependsOn: [{ node: "a", deliverable: true }, { node: "b", deliverable: true }] })
}
`
    const result = await dryRunMissionScriptSource(source, "lint-m1")
    expect(result.ok).toBe(true)
  })

  test("rejects run dispatch without brief", async () => {
    const source = `
export const team = {
  mission_id: "lint-m1",
  terminal: "terminal",
  nodes: {
    terminal: { description: "root" },
    a: { description: "a" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.run("a", { text: "go" })
  await ctx.run("terminal", { brief: { your_work: ["root"], acceptance_slice: ["done"] }, text: "summary", dependsOn: [{ node: "a", deliverable: true }] })
}
`
    const result = await dryRunMissionScriptSource(source, "lint-m1")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_MISSING_BRIEF")
  })

  test("warns on cross-subtree dependsOn deliverable without blocking", () => {
    const team = {
      mission_id: "lint-m1",
      terminal: "a",
      nodes: {
        terminal: { description: "root" },
        a: { description: "a" },
        b: { description: "b" },
      },
    }
    const crossRollupPlan = compileOrchestrationPlan({
      missionId: "lint-m1",
      team,
      orchestrateSource: `
await ctx.run("a", { brief: { your_work: ["a"], acceptance_slice: ["done"] }, text: "go", dependsOn: [{ node: "b", deliverable: true }] })
`,
      scriptHash: "a",
    })
    const crossRollup = lintOrchestrationScript(
      team,
      crossRollupPlan,
      `
await ctx.run("a", { brief: { your_work: ["a"], acceptance_slice: ["done"] }, text: "go", dependsOn: [{ node: "b", deliverable: true }] })
`,
    )
    expect(crossRollup.errors.some((e) => e.code === "SCRIPT_UNKNOWN_NODE")).toBe(false)
    expect(crossRollup.warnings.some((w) => w.includes("cross-subtree"))).toBe(false)

    const crossAfterPlan = compileOrchestrationPlan({
      missionId: "lint-m1",
      team: { ...team, terminal: "b" },
      orchestrateSource: `
await ctx.run("b", { brief: { your_work: ["b"], acceptance_slice: ["done"] }, text: "go", dependsOn: ["a"] })
`,
      scriptHash: "b",
    })
    const crossAfter = lintOrchestrationScript(
      { ...team, terminal: "b" },
      crossAfterPlan,
      `
await ctx.run("b", { brief: { your_work: ["b"], acceptance_slice: ["done"] }, text: "go", dependsOn: ["a"] })
`,
    )
    expect(crossAfter.errors).toHaveLength(0)
  })

  test("does not force ctx.parallel warning for sequential runs", () => {
    const team = {
      mission_id: "lint-m1",
      terminal: "b",
      nodes: {
        terminal: { description: "root" },
        a: { description: "a" },
        b: { description: "b" },
      },
    }
    const source = `
await ctx.run("a", { brief: { your_work: ["a"], acceptance_slice: ["done"] }, text: "go" })
await ctx.run("b", { brief: { your_work: ["b"], acceptance_slice: ["done"] }, text: "go" })
`
    const plan = compileOrchestrationPlan({ missionId: "lint-m1", team, orchestrateSource: source, scriptHash: "warn-parallel" })
    const lint = lintOrchestrationScript(team, plan, source)
    expect(lint.warnings.some((w) => w.includes("ctx.parallel"))).toBe(false)
  })

  test("rejects top-level for loop with ctx.run", async () => {
    const source = `
export const team = {
  mission_id: "lint-m1",
  terminal: "terminal",
  nodes: {
    terminal: { description: "root" },
    a: { description: "a" },
    b: { description: "b" },
  },
}
export default async function orchestrate(ctx) {
  for (const id of ["a", "b"]) {
    await ctx.run(id, { brief: { your_work: [id], acceptance_slice: ["path: reports/" + id + ".md"] }, text: "go" })
  }
  await ctx.run("terminal", { brief: { your_work: ["summary"], acceptance_slice: ["done"] }, text: "summary", dependsOn: [{ node: "a", deliverable: true }, { node: "b", deliverable: true }] })
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
  terminal: "a",
  nodes: { a: { description: "a" } },
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

  test("rejects ctx.template.workOrder in orchestrate", async () => {
    const source = `
export const team = {
  mission_id: "lint-m1",
  terminal: "terminal",
  nodes: {
    terminal: { description: "root" },
    a: { description: "a" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.run("a", {
    brief: { your_work: ["w"], acceptance_slice: ["path: reports/a.md"] },
    text: ctx.template.workOrder("a"),
  })
  await ctx.run("terminal", { brief: { your_work: ["r"], acceptance_slice: ["done"] }, dependsOn: [{ node: "a", deliverable: true }] })
}
`
    const result = await dryRunMissionScriptSource(source, "lint-m1")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_FORBIDDEN_WORK_ORDER_TEMPLATE")
  })

  test("allows run without text", async () => {
    const source = `
export const team = {
  mission_id: "lint-m1",
  terminal: "terminal",
  nodes: {
    terminal: { description: "root" },
    a: { description: "a" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.run("a", { brief: { your_work: ["w"], acceptance_slice: ["path: reports/a.md"] } })
  await ctx.run("terminal", { brief: { your_work: ["r"], acceptance_slice: ["done"] }, dependsOn: [{ node: "a", deliverable: true }] })
}
`
    const result = await dryRunMissionScriptSource(source, "lint-m1")
    expect(result.ok).toBe(true)
  })

  test("warns on leaf acceptance_slice without path", () => {
    const team = {
      mission_id: "lint-m1",
      terminal: "terminal",
      nodes: {
        terminal: { description: "root" },
        a: { description: "a" },
      },
    }
    const source = `
await ctx.run("a", { brief: { your_work: ["w"], acceptance_slice: ["done"] }, text: "go" })
await ctx.run("terminal", { brief: { your_work: ["r"], acceptance_slice: ["done"] }, text: "summary", dependsOn: [{ node: "a", deliverable: true }] })
`
    const plan = compileOrchestrationPlan({ missionId: "lint-m1", team, orchestrateSource: source, scriptHash: "warn-leaf" })
    const lint = lintOrchestrationScript(team, plan, source)
    expect(lint.warnings.some((w) => w.includes("path:"))).toBe(true)
  })

  test("warns on non-literal node id", () => {
    const team = {
      mission_id: "lint-m1",
      terminal: "terminal",
      nodes: {
        terminal: { description: "root" },
        a: { description: "a" },
      },
    }
    const source = `
const target = "a"
await ctx.run(target, { brief: { your_work: ["w"], acceptance_slice: ["path: reports/a.md"] }, text: "go" })
await ctx.run("terminal", { brief: { your_work: ["r"], acceptance_slice: ["done"] }, text: "summary", dependsOn: [{ node: "a", deliverable: true }] })
`
    const plan = compileOrchestrationPlan({ missionId: "lint-m1", team, orchestrateSource: source, scriptHash: "warn-literal" })
    const lint = lintOrchestrationScript(team, plan, source)
    expect(lint.warnings.some((w) => w.includes("non-literal"))).toBe(true)
  })

  test("warns on ctx.run without await", () => {
    const team = {
      mission_id: "lint-m1",
      terminal: "a",
      nodes: { a: { description: "a" } },
    }
    const source = `
ctx.run("a", { brief: { your_work: ["w"], acceptance_slice: ["path: reports/a.md"] }, text: "go" })
await ctx.run("a", { brief: { your_work: ["w"], acceptance_slice: ["path: reports/a.md"] }, text: "go" })
`
    const plan = compileOrchestrationPlan({ missionId: "lint-m1", team, orchestrateSource: source, scriptHash: "warn-await" })
    const lint = lintOrchestrationScript(team, plan, source)
    expect(lint.warnings.some((w) => w.includes("await"))).toBe(true)
  })

  test("compileOrchestrationPlan classifies pipeline steps", () => {
    const team = {
      mission_id: "lint-m1",
      terminal: "terminal",
      nodes: {
        terminal: { description: "root" },
        leaf: { description: "leaf" },
      },
    }
    const plan = compileOrchestrationPlan({
      missionId: "lint-m1",
      team,
      orchestrateSource: `
await ctx.pipeline(["a"], async (item) => item)
await ctx.run("leaf", { brief: { your_work: ["w"], acceptance_slice: ["done"] }, text: "go" })
await ctx.run("terminal", { brief: { your_work: ["r"], acceptance_slice: ["done"] }, text: "final", dependsOn: [{ node: "leaf", deliverable: true }] })
`,
      scriptHash: "pipeline-plan",
    })
    expect(plan.steps.some((step) => step.op === "pipeline")).toBe(true)
  })
})
