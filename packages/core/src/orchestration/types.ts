import type { TeamSpec } from "../tree/types.ts"

export const ORCHESTRATION_STATE_SCHEMA_VERSION = 4

export type OrchestrationSandboxStatus = "stopped" | "running" | "completed" | "failed"

export type OrchestrationSandboxMeta = {
  status: OrchestrationSandboxStatus
  script_hash?: string
  plan_version?: string
  started_at?: string
  stopped_at?: string
  last_error?: string
}

export type OrchestrationNodeStatus = "pending" | "running" | "done" | "blocked" | "rework"

export type NodeArtifact = {
  path: string
  description: string
}

export type NodeCompletion = {
  summary: string
  artifacts?: NodeArtifact[]
  risks?: string[]
  completed_at: string
  round?: number
}

export type OrchestrationNodeState = {
  status: OrchestrationNodeStatus
  round?: number
  blocked_by?: string
  rework_reason?: string
  activated_at?: string
  completed_at?: string
  completion?: NodeCompletion
}

export type OrchestrationState = {
  schema_version: number
  mission_id: string
  updated_at: string
  phase?: string
  nodes: Record<string, OrchestrationNodeState>
  sandbox?: OrchestrationSandboxMeta
  /** Index into compiled plan steps for precise replay. */
  cursor_step_index?: number
  /** Completed plan step ids (step-0, step-1, …). */
  completed_step_ids?: string[]
  /** Frozen baseline snapshot id when continuing from prior work. */
  baseline_id?: string
  /** Parent mission when this run is a continuation (e.g. review slice). */
  continuation_of?: string
}

export type MissionScriptMeta = {
  name?: string
  phases?: string[]
  rework?: {
    peer_allowed?: boolean
    escalate_to?: "root" | "parent"
    allow_coordinator_rework?: boolean
  }
}

export type MissionScriptRecord = {
  missionId: string
  team: TeamSpec
  meta?: MissionScriptMeta
  scriptPath?: string
  scriptHash?: string
  lockedAt: string
}

export type PromptInput = {
  text?: string
  system?: string
  reply?: boolean
  /** Node ids whose structured completion (from gatehouse_execution_complete) is injected into the work order. */
  rollupFrom?: string[]
}

export type MissionContext = {
  /** Frozen mission objective (from registry at orchestration start). */
  objective: string
  prompt(nodeId: string | string[], input: PromptInput): Promise<void>
  setBrief(
    nodeId: string,
    partial: {
      your_work?: string[]
      not_your_job?: string[]
      acceptance_slice?: string[]
      role?: string
    },
  ): Promise<void>
  readMissionContext(): string
  readContract(opts?: { view?: "summary" | "full" }): unknown
  waitFor(nodeId: string, event: "complete", opts?: { timeout?: string }): Promise<void>
  waitForRollup(rootNodeId: string): Promise<void>
  /** Run independent orchestration tracks concurrently; barrier waits for all thunks. */
  parallel<T>(thunks: ReadonlyArray<() => Promise<T>>): Promise<T[]>
  /** Run each item through stages independently (no barrier between items). */
  pipeline<T>(
    items: readonly T[],
    ...stages: ReadonlyArray<(value: unknown, index: number) => Promise<unknown>>
  ): Promise<unknown[]>
  phase(title: string): void
  log(message: string): void
  nodeIds(): string[]
  leaves(): string[]
  children(nodeId: string): string[]
  template: {
    workOrder(nodeId: string, opts?: { context?: string; note?: string; wave?: number }): string
    rework(nodeId: string, input: { requester: string; reason: string; evidence?: string }): string
    reworkResume(nodeId: string, input: { blocker: string; reason?: string }): string
  }
}

export type LoadedMissionScript = {
  team: TeamSpec
  meta?: MissionScriptMeta
  orchestrateSource?: string
  scriptSource: string
  scriptHash: string
  scriptPath: string
  plan?: import("./plan-types.ts").OrchestrationPlan
}
