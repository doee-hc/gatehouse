import { RegistryDatabase } from "../src/registry/db.ts"
import type { OrchestrationPlan } from "../src/orchestration/plan/types.ts"
import { ORCHESTRATION_PLAN_SCHEMA_VERSION } from "../src/orchestration/plan/types.ts"

/** Seed a minimal persisted plan so terminal-node checks resolve in registry/watchdog tests. */
export function seedTerminalPlan(projectDirectory: string, missionId: string, terminalNodeId: string) {
  const plan: OrchestrationPlan = {
    schema_version: ORCHESTRATION_PLAN_SCHEMA_VERSION,
    mission_id: missionId,
    plan_version: "test-plan",
    script_hash: "test-hash",
    terminal_node: terminalNodeId,
    steps: [
      {
        id: "step-0",
        op: "run",
        statement: `await ctx.run("${terminalNodeId}", { text: "marker" })`,
        nodeId: terminalNodeId,
      },
    ],
    warnings: [],
  }
  new RegistryDatabase(projectDirectory).saveOrchestrationPlan(plan)
}
