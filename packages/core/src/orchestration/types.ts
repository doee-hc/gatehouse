import type { MissionTeamSpec } from "../missions/manifest/types.ts"

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

export type NodeCompletion = {
  summary: string
  completed_at: string
  round?: number
  /** Validated JSON payload when the node brief defines completion_schema. */
  structured_output?: unknown
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
  /** Nodes re-armed for prompt inside an in-progress compound (parallel) step. */
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
  team: MissionTeamSpec
  meta?: MissionScriptMeta
  scriptPath?: string
  scriptHash?: string
  lockedAt: string
}

export type DependsOnEntry = string | { node: string; deliverable?: boolean }

export type JsonSchemaObject = Record<string, unknown>

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
  /** JSON Schema the node must satisfy in gatehouse_execution_complete(structured_output=...). */
  completion_schema?: JsonSchemaObject
}

export type RunOpts = {
  brief: NodeBriefPartial | ((nodeId: string) => NodeBriefPartial)
  /** Optional supplementary text merged into the auto-generated work order. */
  text?: string | ((nodeId: string) => string)
  dependsOn?: DependsOnEntry[]
  reply?: boolean
  /** JSON Schema for structured completion; also stored on the node brief. */
  completionSchema?: JsonSchemaObject
  /** When true, ctx.run resolves with structured_output after the node completes. */
  returnStructured?: boolean
}

export type RunResult = {
  structured?: unknown
  summary?: string
}

/** Host/runtime dispatch surface used internally by run. Not available in mission scripts. */
export type OrchestrationEngine = {
  setBrief(nodeId: string, partial: NodeBriefPartial): Promise<void>
  prompt(nodeId: string | string[], input: PromptInput): Promise<void>
  waitFor(
    nodeId: string,
    event: "complete",
    opts?: { timeout?: string },
  ): Promise<{ completion?: NodeCompletion } | void>
}

export type MissionContext = {
  objective: string
  run(nodeId: string, opts: RunOpts): Promise<RunResult | void>
  parallel<T>(tracks: ReadonlyArray<() => Promise<T>>): Promise<T[]>
  pipeline<T, R>(
    items: readonly T[],
    firstStage: (item: T, index: number) => Promise<R>,
    ...restStages: ReadonlyArray<(prev: R, item: T, index: number) => Promise<R>>
  ): Promise<(R | null)[]>
  readMissionContext(): string
  readContract(opts?: { view?: "summary" | "full" }): unknown
  nodeIds(): string[]
  leaves(): string[]
  children(nodeId: string): string[]
}

export type LoadedMissionScript = {
  team: MissionTeamSpec
  meta?: MissionScriptMeta
  orchestrateSource?: string
  scriptSource: string
  scriptHash: string
  scriptPath: string
  plan?: import("./plan-types.ts").OrchestrationPlan
}
