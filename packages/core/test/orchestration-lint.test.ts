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
  await ctx.run("a", { brief: { your_work: ["a"], acceptance_slice: ["done"] }, text: "rollup", rollupFrom: ["a1"] })
  await ctx.run("b", { brief: { your_work: ["b"], acceptance_slice: ["done"] }, text: "rollup", rollupFrom: ["b1"] })
  await ctx.run("root", { brief: { your_work: ["root"], acceptance_slice: ["done"] }, text: "final", rollupFrom: ["a", "b"] })
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
      await ctx.run("a", { brief: { your_work: ["a"], acceptance_slice: ["done"] }, text: "rollup", rollupFrom: ["a1"] })
    },
    async () => {
      await ctx.run("b1", { brief: { your_work: ["b1"], acceptance_slice: ["done"] }, text: "go" })
      await ctx.run("b", { brief: { your_work: ["b"], acceptance_slice: ["done"] }, text: "rollup", rollupFrom: ["b1"] })
    },
  ])
  await ctx.run("root", { brief: { your_work: ["root"], acceptance_slice: ["done"] }, text: "final", rollupFrom: ["a", "b"] })
}
`
    const result = await dryRunMissionScriptSource(source, "lint-m1")
    expect(result.ok).toBe(true)
  })

  test("rejects legacy ctx.pipeline", async () => {
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
      await ctx.run(nodeId, { brief: { your_work: [nodeId], acceptance_slice: ["done"] }, text: "go" })
      return nodeId
    },
    async (nodeId) => {
      await ctx.join(nodeId)
      return nodeId
    },
  )
  await ctx.run("root", { brief: { your_work: ["root"], acceptance_slice: ["done"] }, text: "rollup", rollupFrom: ["a", "b"] })
}
`
    const result = await dryRunMissionScriptSource(source, "lint-m1")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_LEGACY_API")
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
  await ctx.run("root", { brief: { your_work: ["root"], acceptance_slice: ["done"] }, text: "rollup", rollupFrom: ["a"] })
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
await ctx.run("a", { brief: { your_work: ["a"], acceptance_slice: ["done"] }, text: "rollup", rollupFrom: ["b"] })
`,
    )
    expect(lint.errors.some((e) => e.code === "SCRIPT_INVALID_ROLLUP")).toBe(true)
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
  await ctx.run("root", { brief: { your_work: ["rollup"], acceptance_slice: ["done"] }, text: "rollup", rollupFrom: ["a", "b"] })
}
`
    const result = await dryRunMissionScriptSource(source, "lint-m1")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_PLAN_DYNAMIC_TOP_LEVEL")
  })

  test("rejects rollupFrom on ctx.run fan-out", async () => {
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
  await ctx.run(["a", "b"], {
    brief: (id) => ({ your_work: [id], acceptance_slice: ["path: reports/" + id + ".md"] }),
    text: "go",
    rollupFrom: ["a", "b"],
  })
  await ctx.run("root", { brief: { your_work: ["rollup"], acceptance_slice: ["done"] }, text: "rollup", rollupFrom: ["a", "b"] })
}
`
    const result = await dryRunMissionScriptSource(source, "lint-m1")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_ROLLUP_ON_FANOUT")
  })

  test("rejects unknown node in ctx.run array early", async () => {
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
  await ctx.run(["a", "missing"], {
    brief: (id) => ({ your_work: [id], acceptance_slice: ["path: reports/" + id + ".md"] }),
    text: "go",
  })
  await ctx.run("root", { brief: { your_work: ["rollup"], acceptance_slice: ["done"] }, text: "rollup", rollupFrom: ["a"] })
}
`
    const result = await dryRunMissionScriptSource(source, "lint-m1")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_UNKNOWN_NODE")
    expect(result.message).toContain("missing")
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
  await ctx.run("root", { brief: { your_work: ["r"], acceptance_slice: ["done"] }, rollupFrom: ["a"] })
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
await ctx.run("root", { brief: { your_work: ["r"], acceptance_slice: ["done"] }, text: "rollup", rollupFrom: ["a"] })
`,
    )
    expect(lint.warnings.some((w) => w.includes("path:"))).toBe(true)
  })

  test("warns when wait false has no join", () => {
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
await ctx.run("a", { brief: { your_work: ["w"], acceptance_slice: ["path: reports/a.md"] }, text: "go", wait: false })
await ctx.run("root", { brief: { your_work: ["r"], acceptance_slice: ["done"] }, text: "rollup", rollupFrom: ["a"] })
`,
    )
    expect(lint.warnings.some((w) => w.includes("wait: false"))).toBe(true)
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
await ctx.run("root", { brief: { your_work: ["r"], acceptance_slice: ["done"] }, text: "rollup", rollupFrom: ["a"] })
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
