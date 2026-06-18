import type { OrchestrationPlan } from "../orchestration/plan-types.ts"

export type RetroAnalysisStep = {
  step_id: string
  op: "run" | "fork"
  node_ids: string[]
  statement: string
}

function extractRunNodeIds(statement: string) {
  const ids: string[] = []
  const pattern = /ctx\.run\s*\(\s*["'`]([^"'`]+)["'`]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(statement)) !== null) {
    ids.push(match[1]!)
  }
  return ids
}

export function retroAnalysisSteps(plan: OrchestrationPlan): RetroAnalysisStep[] {
  const steps: RetroAnalysisStep[] = []
  for (const step of plan.steps) {
    if (step.op === "run") {
      const nodeIds = step.nodeId ? [step.nodeId] : extractRunNodeIds(step.statement)
      if (nodeIds.length === 0) continue
      steps.push({ step_id: step.id, op: "run", node_ids: nodeIds, statement: step.statement })
      continue
    }
    if (step.op === "fork") {
      const nodeIds = extractRunNodeIds(step.statement)
      if (nodeIds.length === 0) continue
      steps.push({ step_id: step.id, op: "fork", node_ids: nodeIds, statement: step.statement })
    }
  }
  return steps
}

export function retroAnalysisNodeOrder(plan: OrchestrationPlan) {
  const seen = new Set<string>()
  const order: string[] = []
  for (const step of retroAnalysisSteps(plan)) {
    for (const nodeId of step.node_ids) {
      if (seen.has(nodeId)) continue
      seen.add(nodeId)
      order.push(nodeId)
    }
  }
  return order
}
