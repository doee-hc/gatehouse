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

/** Persisted compound-step replay latch (survives sandbox restart). */
export type CompoundReplayState = {
  step_id: string
  reactivated: string[]
}

export type OrchestrationState = {
  schema_version: number
  mission_id: string
  updated_at: string
  phase?: string
  nodes: Record<string, OrchestrationNodeState>
  sandbox?: OrchestrationSandboxMeta
  /** Next plan step index to execute; steps before this are complete. */
  cursor_step_index?: number
  /** Derived from cursor_step_index for legacy readers; do not write directly. */
  completed_step_ids?: string[]
  /** Nodes re-armed for prompt inside an in-progress compound (fork) step. */
  compound_replay?: CompoundReplayState
  /** Frozen baseline snapshot id when continuing from prior work. */
  baseline_id?: string
  /** Parent mission when this run is a continuation (e.g. review slice). */
  continuation_of?: string
}

export type MissionScriptMeta = {
  name?: string
  phases?: string[]
}

export type MissionScriptRecord = {
  missionId: string
  team: TeamSpec
  meta?: MissionScriptMeta
  scriptPath?: string
  scriptHash?: string
  lockedAt: string
}

export type DependsOnEntry = string | { node: string; summary?: boolean }

export type PromptInput = {
  text?: string
  system?: string
  reply?: boolean
  dependsOn?: DependsOnEntry[]
}

export type NodeBriefPartial = {
  your_work?: string[]
  not_your_job?: string[]
  acceptance_slice?: string[]
  role?: string
}

export type RunOpts = {
  brief?: NodeBriefPartial | ((nodeId: string) => NodeBriefPartial)
  text?: string | ((nodeId: string) => string)
  dependsOn?: DependsOnEntry[]
  reply?: boolean
}

/** Host/runtime dispatch surface used internally by run. Not available in mission scripts. */
export type OrchestrationEngine = {
  setBrief(nodeId: string, partial: NodeBriefPartial): Promise<void>
  prompt(nodeId: string | string[], input: PromptInput): Promise<void>
  waitFor(nodeId: string, event: "complete", opts?: { timeout?: string }): Promise<void>
}

export type MissionContext = {
  objective: string
  run(nodeId: string, opts?: RunOpts): Promise<void>
  fork<T>(tracks: ReadonlyArray<() => Promise<T>>): Promise<T[]>
  readMissionContext(): string
  readContract(opts?: { view?: "summary" | "full" }): unknown
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
