import { RegistryDatabase } from "../../registry/db.ts"
import type { OrchestrationBaseline, OrchestrationPlan } from "./types.ts"

function db(projectDirectory: string, readonly = false) {
  return new RegistryDatabase(projectDirectory, readonly ? { readonly: true } : undefined)
}

export function saveOrchestrationPlanRecord(projectDirectory: string, plan: OrchestrationPlan) {
  db(projectDirectory).saveOrchestrationPlan(plan)
}

export function readOrchestrationPlanRecord(
  projectDirectory: string,
  missionId: string,
  planVersion: string,
) {
  return db(projectDirectory, true).getOrchestrationPlan(missionId, planVersion)
}

export function readLatestOrchestrationPlanRecord(projectDirectory: string, missionId: string) {
  return db(projectDirectory, true).getLatestOrchestrationPlan(missionId)
}

export function saveOrchestrationBaselineRecord(projectDirectory: string, baseline: OrchestrationBaseline) {
  db(projectDirectory).saveOrchestrationBaseline(baseline)
}

export function readOrchestrationBaselineRecord(projectDirectory: string, baselineId: string) {
  return db(projectDirectory, true).getOrchestrationBaseline(baselineId)
}
