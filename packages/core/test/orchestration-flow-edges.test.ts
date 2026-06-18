import { describe, expect, test } from "bun:test"
import type { PlanStep } from "../src/orchestration/plan-types.ts"
import { buildPortalOrchestrationFlowEdges } from "../src/portal/orchestration-flow-edges.ts"

describe("portal orchestration flow edges", () => {
  test("builds dispatch and rollup arrows from plan steps", () => {
    const parentByNode = new Map<string, string | null>([
      ["root", null],
      ["a", "root"],
      ["a1", "a"],
      ["leaf", "root"],
    ])

    const planSteps: PlanStep[] = [
      {
        id: "step-0",
        op: "run",
        statement: `await ctx.run("a1", { brief: { your_work: ["w"], acceptance_slice: ["done"] }, text: "go" })`,
        nodeId: "a1",
      },
      {
        id: "step-1",
        op: "run",
        statement: `await ctx.run("a", { brief: { your_work: ["a"], acceptance_slice: ["done"] }, text: "rollup", dependsOn: [{ node: "a1", summary: true }] })`,
        nodeId: "a",
      },
      {
        id: "step-2",
        op: "run",
        statement: `await ctx.run("leaf", { brief: { your_work: ["w"], acceptance_slice: ["done"] }, text: "go" })`,
        nodeId: "leaf",
      },
      {
        id: "step-3",
        op: "run",
        statement: `await ctx.run("root", { brief: { your_work: ["root"], acceptance_slice: ["done"] }, text: "final", dependsOn: [{ node: "a", summary: true }, { node: "leaf", summary: true }] })`,
        nodeId: "root",
      },
    ]

    const states = ["done", "current", "pending", "pending"] as const
    const edges = buildPortalOrchestrationFlowEdges(planSteps, [...states], parentByNode, "root")

    expect(edges).toEqual([
      { step_id: "step-0", from: "a", to: "a1", op: "run", state: "done", kind: "activate" },
      { step_id: "step-1", from: "a1", to: "a", op: "run", state: "current", kind: "rollup" },
      { step_id: "step-2", from: "root", to: "leaf", op: "run", state: "pending", kind: "activate" },
      { step_id: "step-3", from: "a", to: "root", op: "run", state: "pending", kind: "rollup" },
      { step_id: "step-3", from: "leaf", to: "root", op: "run", state: "pending", kind: "rollup" },
    ])
  })

  test("links sequential run steps when dispatch edge is unavailable", () => {
    const parentByNode = new Map<string, string | null>([
      ["root", null],
      ["leaf", "root"],
    ])
    const planSteps: PlanStep[] = [
      {
        id: "step-0",
        op: "run",
        statement: `await ctx.run("leaf", { text: "go" })`,
        nodeId: "leaf",
      },
      {
        id: "step-1",
        op: "run",
        statement: `await ctx.run("root", { text: "rollup" })`,
        nodeId: "root",
      },
    ]
    const edges = buildPortalOrchestrationFlowEdges(
      planSteps,
      ["done", "current"],
      parentByNode,
      "root",
    )
    expect(edges).toEqual([
      { step_id: "step-0", from: "root", to: "leaf", op: "run", state: "done", kind: "activate" },
      { step_id: "step-1", from: "leaf", to: "root", op: "run", state: "current", kind: "serial" },
    ])
  })

  test("links sequential sibling run steps under the same parent", () => {
    const parentByNode = new Map<string, string | null>([
      ["root", null],
      ["lead", "root"],
      ["a", "lead"],
      ["b", "lead"],
      ["c", "lead"],
    ])
    const planSteps: PlanStep[] = [
      {
        id: "step-0",
        op: "run",
        statement: `await ctx.run("a", { text: "go" })`,
        nodeId: "a",
      },
      {
        id: "step-1",
        op: "run",
        statement: `await ctx.run("b", { text: "go" })`,
        nodeId: "b",
      },
      {
        id: "step-2",
        op: "run",
        statement: `await ctx.run("c", { text: "go" })`,
        nodeId: "c",
      },
    ]
    const edges = buildPortalOrchestrationFlowEdges(
      planSteps,
      ["done", "done", "current"],
      parentByNode,
      "root",
    )
    expect(edges).toEqual([
      { step_id: "step-0", from: "lead", to: "a", op: "run", state: "done", kind: "activate" },
      { step_id: "step-1", from: "lead", to: "b", op: "run", state: "done", kind: "activate" },
      { step_id: "step-1", from: "a", to: "b", op: "run", state: "done", kind: "serial" },
      { step_id: "step-2", from: "lead", to: "c", op: "run", state: "current", kind: "activate" },
      { step_id: "step-2", from: "b", to: "c", op: "run", state: "current", kind: "serial" },
    ])
  })

  test("builds cross-parent dependsOn dependency arrows", () => {
    const parentByNode = new Map<string, string | null>([
      ["root", null],
      ["a", "root"],
      ["b", "root"],
      ["a1", "a"],
      ["b1", "b"],
    ])
    const planSteps: PlanStep[] = [
      {
        id: "step-0",
        op: "run",
        statement: `await ctx.run("a1", { text: "go" })`,
        nodeId: "a1",
      },
      {
        id: "step-1",
        op: "run",
        statement: `await ctx.run("b1", { text: "go", dependsOn: ["a1"] })`,
        nodeId: "b1",
      },
    ]
    const edges = buildPortalOrchestrationFlowEdges(
      planSteps,
      ["done", "current"],
      parentByNode,
      "root",
    )
    expect(edges).toEqual([
      { step_id: "step-0", from: "a", to: "a1", op: "run", state: "done", kind: "activate" },
      { step_id: "step-1", from: "b", to: "b1", op: "run", state: "current", kind: "activate" },
      { step_id: "step-1", from: "a1", to: "b1", op: "run", state: "current", kind: "depends" },
    ])
  })

  test("extracts nested run steps inside ctx.fork for dispatch and rollup arrows", () => {
    const parentByNode = new Map<string, string | null>([
      ["root", null],
      ["research-lead", "root"],
      ["analysis-lead", "root"],
      ["gpt-researcher", "research-lead"],
      ["claude-researcher", "research-lead"],
      ["benchmark-analyst", "analysis-lead"],
      ["pricing-analyst", "analysis-lead"],
    ])
    const planSteps: PlanStep[] = [
      {
        id: "step-0",
        op: "fork",
        statement: `
await ctx.fork([
  async () => {
    await ctx.run("gpt-researcher", { text: "go" })
    await ctx.run("claude-researcher", { text: "go" })
    await ctx.run("research-lead", {
      text: "rollup",
      dependsOn: [{ node: "gpt-researcher", summary: true }, { node: "claude-researcher", summary: true }],
    })
  },
  async () => {
    await ctx.run("benchmark-analyst", { text: "go" })
    await ctx.run("pricing-analyst", { text: "go" })
    await ctx.run("analysis-lead", {
      text: "rollup",
      dependsOn: [{ node: "benchmark-analyst", summary: true }, { node: "pricing-analyst", summary: true }],
    })
  },
])`,
      },
    ]
    const edges = buildPortalOrchestrationFlowEdges(planSteps, ["done"], parentByNode, "root")
    expect(edges).toEqual([
      {
        step_id: "step-0",
        from: "research-lead",
        to: "gpt-researcher",
        op: "run",
        state: "done",
        kind: "activate",
      },
      {
        step_id: "step-0",
        from: "research-lead",
        to: "claude-researcher",
        op: "run",
        state: "done",
        kind: "activate",
      },
      {
        step_id: "step-0",
        from: "gpt-researcher",
        to: "claude-researcher",
        op: "run",
        state: "done",
        kind: "serial",
      },
      {
        step_id: "step-0",
        from: "gpt-researcher",
        to: "research-lead",
        op: "run",
        state: "done",
        kind: "rollup",
      },
      {
        step_id: "step-0",
        from: "claude-researcher",
        to: "research-lead",
        op: "run",
        state: "done",
        kind: "rollup",
      },
      {
        step_id: "step-0",
        from: "analysis-lead",
        to: "benchmark-analyst",
        op: "run",
        state: "done",
        kind: "activate",
      },
      {
        step_id: "step-0",
        from: "analysis-lead",
        to: "pricing-analyst",
        op: "run",
        state: "done",
        kind: "activate",
      },
      {
        step_id: "step-0",
        from: "benchmark-analyst",
        to: "pricing-analyst",
        op: "run",
        state: "done",
        kind: "serial",
      },
      {
        step_id: "step-0",
        from: "benchmark-analyst",
        to: "analysis-lead",
        op: "run",
        state: "done",
        kind: "rollup",
      },
      {
        step_id: "step-0",
        from: "pricing-analyst",
        to: "analysis-lead",
        op: "run",
        state: "done",
        kind: "rollup",
      },
    ])
  })

  test("does not link parallel fork tracks that dispatch sibling nodes", () => {
    const parentByNode = new Map<string, string | null>([
      ["root", null],
      ["playbook-synthesis", "root"],
      ["playbook-assessment", "root"],
      ["playbook-roadmap", "root"],
    ])
    const planSteps: PlanStep[] = [
      {
        id: "step-0",
        op: "fork",
        statement: `
await ctx.fork([
  async () => {
    await ctx.run("playbook-synthesis", { text: "go" })
  },
  async () => {
    await ctx.run("playbook-assessment", { text: "go" })
  },
  async () => {
    await ctx.run("playbook-roadmap", { text: "go" })
  },
])`,
      },
      {
        id: "step-1",
        op: "run",
        statement: `await ctx.run("root", {
  text: "rollup",
  dependsOn: [
    { node: "playbook-synthesis", summary: true },
    { node: "playbook-assessment", summary: true },
    { node: "playbook-roadmap", summary: true },
  ],
})`,
        nodeId: "root",
      },
    ]
    const edges = buildPortalOrchestrationFlowEdges(planSteps, ["done", "done"], parentByNode, "root")
    expect(edges).toEqual([
      {
        step_id: "step-0",
        from: "root",
        to: "playbook-synthesis",
        op: "run",
        state: "done",
        kind: "activate",
      },
      {
        step_id: "step-0",
        from: "root",
        to: "playbook-assessment",
        op: "run",
        state: "done",
        kind: "activate",
      },
      {
        step_id: "step-0",
        from: "root",
        to: "playbook-roadmap",
        op: "run",
        state: "done",
        kind: "activate",
      },
      {
        step_id: "step-1",
        from: "playbook-synthesis",
        to: "root",
        op: "run",
        state: "done",
        kind: "rollup",
      },
      {
        step_id: "step-1",
        from: "playbook-assessment",
        to: "root",
        op: "run",
        state: "done",
        kind: "rollup",
      },
      {
        step_id: "step-1",
        from: "playbook-roadmap",
        to: "root",
        op: "run",
        state: "done",
        kind: "rollup",
      },
    ])
  })
})
