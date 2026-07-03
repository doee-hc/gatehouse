import { createHash } from "node:crypto"

export const ORCHESTRATION_PLAN_SCHEMA_VERSION = 1

export type PlanStepOp = "run" | "fork" | "other"

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
  /** Lead delivery node; inferred as the plan dependency sink at compile time. */
  terminal_node?: string
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

