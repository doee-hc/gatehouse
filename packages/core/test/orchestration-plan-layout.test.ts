import { describe, expect, test } from "bun:test"
import type { PortalOrchestrationFlowEdge } from "../src/portal/orchestration-flow-edges.ts"
import {
  activationOrderFromPlan,
  computePlanNodeLayers,
  maxPlanLayoutDepth,
  maxPlanLayoutWidth,
} from "../src/portal/orchestration-plan-layout.ts"

describe("orchestration plan layout", () => {
  test("layers nodes by longest path through flow edges", () => {
    const nodeIds = ["a1", "a", "leaf", "root"]
    const flowEdges: PortalOrchestrationFlowEdge[] = [
      { step_id: "s1", from: "a1", to: "a", op: "run", state: "done", kind: "deliverable" },
      { step_id: "s3", from: "a", to: "root", op: "run", state: "pending", kind: "deliverable" },
      { step_id: "s3", from: "leaf", to: "root", op: "run", state: "pending", kind: "deliverable" },
    ]
    const activationOrder = activationOrderFromPlan(nodeIds, flowEdges, ["a1", "a", "leaf", "root"])
    const layers = computePlanNodeLayers(nodeIds, flowEdges, activationOrder)

    expect(layers.get("a1")).toEqual({ depth: 0, rank: 0 })
    expect(layers.get("leaf")).toEqual({ depth: 0, rank: 1 })
    expect(layers.get("a")).toEqual({ depth: 1, rank: 0 })
    expect(layers.get("root")).toEqual({ depth: 2, rank: 0 })
    expect(maxPlanLayoutDepth(layers)).toBe(2)
    expect(maxPlanLayoutWidth(layers)).toBe(2)
  })
})
