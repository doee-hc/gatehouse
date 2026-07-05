import { describe, expect, test } from "bun:test"
import type { PlanStep } from "../src/orchestration/plan-types.ts"
import { buildPortalOrchestrationFlowEdges } from "../src/portal/orchestration-flow-edges.ts"

describe("portal orchestration flow edges", () => {
  test("builds rollup arrows from plan steps", () => {
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
        statement: `await ctx.run("a", { brief: { your_work: ["a"], acceptance_slice: ["done"] }, text: "summary", dependsOn: [{ node: "a1", deliverable: true }] })`,
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
        statement: `await ctx.run("terminal", { brief: { your_work: ["root"], acceptance_slice: ["done"] }, text: "final", dependsOn: [{ node: "a", deliverable: true }, { node: "leaf", deliverable: true }] })`,
        nodeId: "terminal",
      },
    ]

    const states = ["done", "current", "pending", "pending"] as const
    const edges = buildPortalOrchestrationFlowEdges(planSteps, [...states])

    expect(edges).toEqual([
      { step_id: "step-1", from: "a1", to: "a", op: "run", state: "current", kind: "deliverable" },
      { step_id: "step-3", from: "a", to: "terminal", op: "run", state: "pending", kind: "deliverable" },
      { step_id: "step-3", from: "leaf", to: "terminal", op: "run", state: "pending", kind: "deliverable" },
    ])
  })

  test("links sequential run steps across plan steps", () => {
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
        statement: `await ctx.run("terminal", { text: "summary" })`,
        nodeId: "terminal",
      },
    ]
    const edges = buildPortalOrchestrationFlowEdges(planSteps, ["done", "current"])
    expect(edges).toEqual([
      { step_id: "step-1", from: "leaf", to: "terminal", op: "run", state: "current", kind: "serial" },
    ])
  })

  test("links sequential sibling run steps under separate plan steps", () => {
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
    const edges = buildPortalOrchestrationFlowEdges(planSteps, ["done", "done", "current"])
    expect(edges).toEqual([
      { step_id: "step-1", from: "a", to: "b", op: "run", state: "done", kind: "serial" },
      { step_id: "step-2", from: "b", to: "c", op: "run", state: "current", kind: "serial" },
    ])
  })

  test("builds cross-branch dependsOn dependency arrows", () => {
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
    const edges = buildPortalOrchestrationFlowEdges(planSteps, ["done", "current"])
    expect(edges).toEqual([
      { step_id: "step-1", from: "a1", to: "b1", op: "run", state: "current", kind: "depends" },
    ])
  })

  test("extracts nested run steps inside ctx.parallel for rollup and serial arrows", () => {
    const planSteps: PlanStep[] = [
      {
        id: "step-0",
        op: "parallel",
        statement: `
await ctx.parallel([
  async () => {
    await ctx.run("gpt-researcher", { text: "go" })
    await ctx.run("claude-researcher", { text: "go" })
    await ctx.run("research-lead", {
      text: "summary",
      dependsOn: [{ node: "gpt-researcher", deliverable: true }, { node: "claude-researcher", deliverable: true }],
    })
  },
  async () => {
    await ctx.run("benchmark-analyst", { text: "go" })
    await ctx.run("pricing-analyst", { text: "go" })
    await ctx.run("analysis-lead", {
      text: "summary",
      dependsOn: [{ node: "benchmark-analyst", deliverable: true }, { node: "pricing-analyst", deliverable: true }],
    })
  },
])`,
      },
    ]
    const edges = buildPortalOrchestrationFlowEdges(planSteps, ["done"])
    expect(edges).toEqual([
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
        kind: "deliverable",
      },
      {
        step_id: "step-0",
        from: "claude-researcher",
        to: "research-lead",
        op: "run",
        state: "done",
        kind: "deliverable",
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
        kind: "deliverable",
      },
      {
        step_id: "step-0",
        from: "pricing-analyst",
        to: "analysis-lead",
        op: "run",
        state: "done",
        kind: "deliverable",
      },
    ])
  })

  test("does not link parallel tracks that dispatch sibling nodes", () => {
    const planSteps: PlanStep[] = [
      {
        id: "step-0",
        op: "parallel",
        statement: `
await ctx.parallel([
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
        statement: `await ctx.run("terminal", {
  text: "summary",
  dependsOn: [
    { node: "playbook-synthesis", deliverable: true },
    { node: "playbook-assessment", deliverable: true },
    { node: "playbook-roadmap", deliverable: true },
  ],
})`,
        nodeId: "terminal",
      },
    ]
    const edges = buildPortalOrchestrationFlowEdges(planSteps, ["done", "done"])
    expect(edges).toEqual([
      {
        step_id: "step-1",
        from: "playbook-synthesis",
        to: "terminal",
        op: "run",
        state: "done",
        kind: "deliverable",
      },
      {
        step_id: "step-1",
        from: "playbook-assessment",
        to: "terminal",
        op: "run",
        state: "done",
        kind: "deliverable",
      },
      {
        step_id: "step-1",
        from: "playbook-roadmap",
        to: "terminal",
        op: "run",
        state: "done",
        kind: "deliverable",
      },
    ])
  })
})
