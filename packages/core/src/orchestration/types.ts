import type { TeamSpec } from "../tree/types.ts"

export const ORCHESTRATION_STATE_SCHEMA_VERSION = 1

export type OrchestrationNodeStatus = "pending" | "running" | "done" | "blocked" | "rework"

export type OrchestrationNodeState = {
  status: OrchestrationNodeStatus
  round?: number
  blocked_by?: string
  rework_reason?: string
  activated_at?: string
  completed_at?: string
}

export type OrchestrationState = {
  schema_version: number
  mission_id: string
  updated_at: string
  phase?: string
  nodes: Record<string, OrchestrationNodeState>
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
  waitForAll(nodeIds: string[], event: "complete", opts?: { timeout?: string }): Promise<void>
  waitForRollup(rootNodeId: string): Promise<void>
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
}
