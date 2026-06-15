import { RegistryDatabase } from "../registry/db.ts"
import type { OrchestrationState } from "./types.ts"
import {
  ORCHESTRATION_STATE_SCHEMA_VERSION,
  type OrchestrationNodeState,
} from "./types.ts"
import { notifyOrchestrationWaiters } from "./wait.ts"

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
    sandbox: { status: "stopped" },
  }
}

export function readOrchestrationState(projectDirectory: string, missionId: string) {
  const raw = db(projectDirectory, true).getOrchestrationState(missionId)
  return raw ? normalizeOrchestrationState(raw) : undefined
}

function normalizeOrchestrationState(state: OrchestrationState): OrchestrationState {
  state.schema_version = ORCHESTRATION_STATE_SCHEMA_VERSION
  if (!state.sandbox) {
    state.sandbox = {
      status: orchestrationAllDone(state) ? "completed" : "stopped",
    }
  }
  if (state.cursor_step_index === undefined) state.cursor_step_index = 0
  if (!state.completed_step_ids) state.completed_step_ids = []
  return state
}

export function isPlanStepCompleted(state: OrchestrationState, stepId: string) {
  return state.completed_step_ids?.includes(stepId) ?? false
}

export function markPlanStepCompleted(state: OrchestrationState, stepId: string, stepIndex: number) {
  const completed = new Set(state.completed_step_ids ?? [])
  completed.add(stepId)
  state.completed_step_ids = [...completed]
  state.cursor_step_index = Math.max(state.cursor_step_index ?? 0, stepIndex + 1)
}

export function assertOrchestrationPlanVersion(
  state: OrchestrationState | undefined,
  planVersion: string,
  opts?: { allowNewPlan?: boolean },
): { ok: true } | { ok: false; message: string } {
  const locked = state?.sandbox?.plan_version
  if (!locked) return { ok: true }
  if (locked === planVersion) return { ok: true }
  if (opts?.allowNewPlan) return { ok: true }
  return {
    ok: false,
    message: `orchestration plan changed during run (locked ${locked}, current ${planVersion}); use gatehouse_submit_orchestration(mode=continue)`,
  }
}

export function writeOrchestrationState(projectDirectory: string, state: OrchestrationState) {
  db(projectDirectory).saveOrchestrationState(state)
  notifyOrchestrationWaitersAfterWrite(projectDirectory, state.mission_id)
}

export function mutateOrchestrationState(
  projectDirectory: string,
  missionId: string,
  mutator: (state: OrchestrationState) => void,
) {
  const next = db(projectDirectory).mutateOrchestrationState(missionId, mutator)
  if (next) notifyOrchestrationWaiters(missionId, next)
  return next
}

function notifyOrchestrationWaitersAfterWrite(projectDirectory: string, missionId: string) {
  const fresh = readOrchestrationState(projectDirectory, missionId)
  if (fresh) notifyOrchestrationWaiters(missionId, fresh)
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

export function orchestrationAllDone(state: OrchestrationState) {
  return Object.values(state.nodes).every((node) => node.status === "done")
}

export function orchestrationNeedsResume(state: OrchestrationState | undefined, sandboxRunning: boolean) {
  if (sandboxRunning) return false
  if (!state) return false
  return !orchestrationAllDone(state)
}

export function assertOrchestrationScriptHash(
  state: OrchestrationState | undefined,
  scriptHash: string,
  opts?: { allowNewPlan?: boolean },
): { ok: true } | { ok: false; message: string } {
  const locked = state?.sandbox?.script_hash
  if (!locked) return { ok: true }
  if (locked === scriptHash) return { ok: true }
  if (opts?.allowNewPlan) return { ok: true }
  return {
    ok: false,
    message: `mission.script.ts changed during orchestration (locked ${locked.slice(0, 12)}…, current ${scriptHash.slice(0, 12)}…); use gatehouse_submit_orchestration(mode=continue)`,
  }
}

export function markSandboxRunning(state: OrchestrationState, scriptHash: string, planVersion?: string) {
  const now = new Date().toISOString()
  state.sandbox = {
    status: "running",
    script_hash: scriptHash,
    ...(planVersion && { plan_version: planVersion }),
    started_at: now,
    stopped_at: undefined,
    last_error: undefined,
  }
}

export function markSandboxStopped(
  state: OrchestrationState,
  outcome: "stopped" | "completed" | "failed",
  error?: string,
) {
  const now = new Date().toISOString()
  state.sandbox = {
    ...(state.sandbox ?? { status: "stopped" as const }),
    status: outcome,
    stopped_at: now,
    ...(error && { last_error: error }),
  }
}

export function nodeAlreadyActivated(state: OrchestrationState, nodeId: string) {
  const node = state.nodes[nodeId]
  return (
    node?.status === "running" ||
    node?.status === "done" ||
    node?.status === "rework" ||
    node?.status === "blocked"
  )
}

/** Plan-aware: skip reply prompt only when this plan step already completed. */
export function shouldSkipReplyPromptStep(state: OrchestrationState, stepId?: string) {
  if (stepId) return isPlanStepCompleted(state, stepId)
  return false
}

export const AWAITING_SKILL_DOMAINS_PHASE = "awaiting_skill_domains"

/** True when bootstrap must seed missing team nodes (e.g. after awaiting_skill_domains). */
export function orchestrationStateNeedsNodeInit(
  state: OrchestrationState,
  nodeIds: readonly string[],
): boolean {
  if (state.phase === AWAITING_SKILL_DOMAINS_PHASE) return true
  return nodeIds.some((nodeId) => !state.nodes[nodeId])
}

/** Merge fresh pending nodes with any existing progress; clears awaiting_skill_domains phase. */
export function ensureOrchestrationNodesInitialized(
  existing: OrchestrationState,
  nodeIds: readonly string[],
): OrchestrationState {
  const next = initOrchestrationState(existing.mission_id, [...nodeIds])
  for (const nodeId of nodeIds) {
    const current = existing.nodes[nodeId]
    if (current) next.nodes[nodeId] = { ...current }
  }
  next.cursor_step_index = existing.cursor_step_index ?? 0
  next.completed_step_ids = existing.completed_step_ids ?? []
  next.sandbox = existing.sandbox ?? next.sandbox
  if (existing.baseline_id) next.baseline_id = existing.baseline_id
  if (existing.phase && existing.phase !== AWAITING_SKILL_DOMAINS_PHASE) {
    next.phase = existing.phase
  }
  return next
}

export function initAwaitingSkillDomainsState(missionId: string, scriptHash: string): OrchestrationState {
  return {
    schema_version: ORCHESTRATION_STATE_SCHEMA_VERSION,
    mission_id: missionId,
    updated_at: new Date().toISOString(),
    phase: AWAITING_SKILL_DOMAINS_PHASE,
    nodes: {},
    sandbox: { status: "stopped", script_hash: scriptHash },
  }
}

export function isAwaitingSkillDomainsForScript(
  state: OrchestrationState | undefined,
  scriptHash: string,
): boolean {
  return state?.phase === AWAITING_SKILL_DOMAINS_PHASE && state.sandbox?.script_hash === scriptHash
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
