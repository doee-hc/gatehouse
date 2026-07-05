import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { initOrchestrationState, markNodeRunning, writeOrchestrationState } from "../src/orchestration/state.ts"
import { saveOrchestrationPlanRecord } from "../src/orchestration/plan-store.ts"
import { compileOrchestrationPlan } from "../src/orchestration/plan-compile.ts"
import { buildPortalOrchestration } from "../src/portal/orchestration-view.ts"
import type { PortalTree } from "../src/portal/snapshot.ts"

describe("portal orchestration view", () => {
  test("merges tree structure with orchestration node status and plan steps", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-portal-orch-view-"))
    try {
      const missionId = "orch-view-m1"
      const tree: PortalTree = {
        mission_id: missionId,
        terminal_node: "terminal",
        status: "running",
        nodes: [
          {
            node_id: "terminal",
            session_id: "ses_terminal",
            display_name: "Terminal",
          },
          {
            node_id: "leaf",
            session_id: "ses_leaf",
            display_name: "Leaf",
            skill_domain: "docs",
          },
        ],
      }

      const orchestrateSource = `
await ctx.run("leaf", { brief: { your_work: ["w"], acceptance_slice: ["done"] }, text: "go" })
await ctx.run("terminal", { brief: { your_work: ["r"], acceptance_slice: ["done"] }, text: "rollup", dependsOn: [{ node: "leaf", deliverable: true }] })
`

      const plan = compileOrchestrationPlan({
        missionId,
        team: {
          mission_id: missionId,
          terminal: "terminal",
          nodes: {
            terminal: { description: "terminal" },
            leaf: { description: "leaf" },
          },
        },
        orchestrateSource,
        scriptHash: "abc123",
      })
      saveOrchestrationPlanRecord(dir, plan)

      const state = initOrchestrationState(missionId, ["terminal", "leaf"])
      state.phase = "阶段一"
      state.completed_step_ids = ["step-0"]
      state.cursor_step_index = 1
      markNodeRunning(state, "leaf")
      writeOrchestrationState(dir, state)

      const view = buildPortalOrchestration(dir, tree)
      expect(view?.mission_id).toBe(missionId)
      expect(view?.nodes.find((node) => node.node_id === "leaf")?.status).toBe("running")
      expect(view?.nodes.find((node) => node.node_id === "terminal")?.status).toBe("pending")
      expect(view?.phases.some((phase) => phase.title === "阶段一" && phase.state === "current")).toBe(true)
      expect(view?.steps.find((step) => step.id === "step-1")?.state).toBe("current")
      expect(view?.completed_steps).toBe(1)
      expect(view?.flow_edges.some((edge) => edge.from === "leaf" && edge.to === "terminal" && edge.state === "current")).toBe(
        true,
      )
      expect(view?.activation_order).toEqual(["leaf", "terminal"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
