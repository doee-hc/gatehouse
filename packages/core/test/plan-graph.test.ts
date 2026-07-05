import { describe, expect, test } from "bun:test"
import { compileOrchestrationPlan } from "../src/orchestration/plan-compile.ts"
import {
  acceptanceLayerNodeIds,
  inferTerminalNodeFromPlan,
  listPlanRunActivations,
  planLeafNodeIds,
  upstreamDependsOnNodes,
} from "../src/orchestration/plan-graph.ts"
import { validateReworkRequest } from "../src/orchestration/rework.ts"
import { initOrchestrationState } from "../src/orchestration/state.ts"
import type { MissionTeamSpec } from "../src/missions/manifest/types.ts"

const team: MissionTeamSpec = {
  mission_id: "m1",
  terminal: "a",
  nodes: {
    a: { description: "worker a" },
    b: { description: "worker b" },
  },
}

function compile(orchestrateSource: string) {
  return compileOrchestrationPlan({
    missionId: "m1",
    team,
    orchestrateSource,
    scriptHash: "hash",
  })
}

describe("plan-graph", () => {
  test("inferTerminalNodeFromPlan picks dependency sink", () => {
    const plan = compile(`
  await ctx.run("b", { brief: { your_work: ["b"], acceptance_slice: [] }, text: "b" })
  await ctx.run("a", {
    brief: { your_work: ["a"], acceptance_slice: [] },
    text: "a",
    dependsOn: [{ node: "b", deliverable: true }],
  })
`)
    expect(plan.terminal_node).toBe("a")
    expect(inferTerminalNodeFromPlan(plan)).toBe("a")
  })

  test("inferTerminalNodeFromPlan handles parallel then final synthesis", () => {
    const plan = compile(`
  await ctx.parallel([
    async () => {
      await ctx.run("b", { brief: { your_work: ["b"], acceptance_slice: [] }, text: "b" })
    },
  ])
  await ctx.run("a", {
    brief: { your_work: ["a"], acceptance_slice: [] },
    text: "a",
    dependsOn: [{ node: "b", deliverable: true }],
  })
`)
    expect(inferTerminalNodeFromPlan(plan)).toBe("a")
  })

  test("listPlanRunActivations preserves dependsOn", () => {
    const plan = compile(`
  await ctx.run("b", { brief: { your_work: ["b"], acceptance_slice: [] }, text: "b" })
  await ctx.run("a", {
    brief: { your_work: ["a"], acceptance_slice: [] },
    text: "a",
    dependsOn: ["b"],
  })
`)
    const activations = listPlanRunActivations(plan)
    expect(activations).toHaveLength(2)
    expect(upstreamDependsOnNodes(plan, "a")).toEqual(new Set(["b"]))
  })

  test("acceptanceLayerNodeIds lists nodes with deliverable dependsOn", () => {
    const multiTeam: MissionTeamSpec = {
      mission_id: "m1",
      terminal: "terminal",
      nodes: {
        terminal: { description: "terminal" },
        a: { description: "track synthesis" },
        leaf: { description: "leaf" },
      },
    }
    const plan = compileOrchestrationPlan({
      missionId: "m1",
      team: multiTeam,
      orchestrateSource: `
  await ctx.run("leaf", { brief: { your_work: ["leaf"], acceptance_slice: [] }, text: "go" })
  await ctx.run("a", {
    brief: { your_work: ["a"], acceptance_slice: [] },
    text: "join",
    dependsOn: [{ node: "leaf", deliverable: true }],
  })
  await ctx.run("terminal", {
    brief: { your_work: ["final"], acceptance_slice: [] },
    text: "final",
    dependsOn: [{ node: "a", deliverable: true }],
  })
`,
      scriptHash: "hash",
    })
    expect([...acceptanceLayerNodeIds(plan)].sort()).toEqual(["a", "terminal"])
    expect(planLeafNodeIds(multiTeam, plan)).toEqual(["leaf"])
  })
})

describe("rework dependsOn upstream", () => {
  const plan = compile(`
  await ctx.run("b", { brief: { your_work: ["b"], acceptance_slice: [] }, text: "b" })
  await ctx.run("a", {
    brief: { your_work: ["a"], acceptance_slice: [] },
    text: "a",
    dependsOn: [{ node: "b", deliverable: true }],
  })
`)

  test("allows downstream to rework upstream dependsOn node", () => {
    const state = initOrchestrationState("m1", ["a", "b"])
    state.nodes.a = { status: "running" }
    state.nodes.b = { status: "done" }
    const result = validateReworkRequest({
      team,
      plan,
      state,
      requesterNodeId: "a",
      blockedByNodeId: "b",
    })
    expect(result.ok).toBe(true)
  })

  test("rejects rework without dependsOn edge", () => {
    const state = initOrchestrationState("m1", ["a", "b"])
    state.nodes.b = { status: "running" }
    state.nodes.a = { status: "done" }
    const result = validateReworkRequest({
      team,
      plan,
      state,
      requesterNodeId: "b",
      blockedByNodeId: "a",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("FORBIDDEN_REWORK")
  })
})
