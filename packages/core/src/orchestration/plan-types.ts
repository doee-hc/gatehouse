import { createHash } from "node:crypto"
import type { TeamSpec } from "../tree/types.ts"

export const ORCHESTRATION_PLAN_SCHEMA_VERSION = 1

export type PlanStepOp = "run" | "join" | "fork" | "other"

export type PlanStep = {
  id: string
  op: PlanStepOp
  /** Original await statement source (for dynamic execution). */
  statement: string
  nodeId?: string
  rootNodeId?: string
}

export type OrchestrationPlan = {
  schema_version: number
  mission_id: string
  plan_version: string
  script_hash: string
  steps: PlanStep[]
  warnings: string[]
}

export type OrchestrationBaselineNode = {
  node_id: string
  status: "done"
  completed_at?: string
  summary?: string
  artifact_paths?: string[]
}

export type OrchestrationBaseline = {
  baseline_id: string
  mission_id: string
  captured_at: string
  parent_mission_id?: string
  delivery_version?: number
  nodes: OrchestrationBaselineNode[]
}

export type OrchestrationCursor = {
  step_index: number
  completed_step_ids: string[]
}

export function hashPlanVersion(plan: Pick<OrchestrationPlan, "script_hash" | "steps">) {
  const payload = `${plan.script_hash}:${plan.steps.map((step) => step.id).join(",")}`
  return createHash("sha256").update(payload).digest("hex").slice(0, 16)
}

export function emptyCursor(): OrchestrationCursor {
  return { step_index: 0, completed_step_ids: [] }
}

export function leafDescendants(team: TeamSpec, rootNodeId: string) {
  const leaves: string[] = []
  const walk = (nodeId: string) => {
    const children = Object.entries(team.nodes)
      .filter(([, node]) => node.parent === nodeId)
      .map(([id]) => id)
    if (children.length === 0) {
      leaves.push(nodeId)
      return
    }
    for (const child of children) walk(child)
  }
  walk(rootNodeId)
  return leaves.filter((id) => id !== rootNodeId)
}
