import { RegistryDatabase } from "../registry/db.ts"
import {
  ORCHESTRATION_STATE_SCHEMA_VERSION,
  type OrchestrationNodeState,
  type OrchestrationState,
} from "./types.ts"

function db(projectDirectory: string, readonly = false) {
  return new RegistryDatabase(projectDirectory, readonly ? { readonly: true } : undefined)
}

export function initOrchestrationState(missionId: string, nodeIds: string[]): OrchestrationState {
  const nodes: Record<string, OrchestrationNodeState> = {}
  for (const nodeId of nodeIds) {
    nodes[nodeId] = { status: "pending" }
  }
  return {
    schema_version: ORCHESTRATION_STATE_SCHEMA_VERSION,
    mission_id: missionId,
    updated_at: new Date().toISOString(),
    nodes,
  }
}

export function readOrchestrationState(projectDirectory: string, missionId: string) {
  return db(projectDirectory, true).getOrchestrationState(missionId)
}

export function writeOrchestrationState(projectDirectory: string, state: OrchestrationState) {
  db(projectDirectory).saveOrchestrationState(state)
}

export function hasOrchestrationRuntime(projectDirectory: string, missionId: string) {
  return db(projectDirectory, true).getMissionScript(missionId) !== undefined
}

export function nodeIsCompleteForWait(state: OrchestrationState, nodeId: string) {
  return state.nodes[nodeId]?.status === "done"
}

export function orchestrationProblemNodeIds(state: OrchestrationState) {
  return Object.entries(state.nodes)
    .filter(([, node]) => node.status === "running" || node.status === "rework")
    .map(([nodeId]) => nodeId)
}

export function allNodesCompleteForWait(state: OrchestrationState, nodeIds: string[]) {
  return nodeIds.every((id) => nodeIsCompleteForWait(state, id))
}

export function markNodeRunning(state: OrchestrationState, nodeId: string) {
  const now = new Date().toISOString()
  const current = state.nodes[nodeId] ?? { status: "pending" as const }
  const round = current.status === "done" ? (current.round ?? 1) + 1 : (current.round ?? 1)
  state.nodes[nodeId] = {
    status: "running",
    round,
    activated_at: now,
    completed_at: undefined,
    blocked_by: undefined,
    rework_reason: undefined,
  }
}
