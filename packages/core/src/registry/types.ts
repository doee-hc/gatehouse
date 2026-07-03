export const REGISTRY_SCHEMA_VERSION = 11

export const OUTER_LEAD_ID = "outer:lead"
export const OUTER_ARCHITECT_ID = "outer:architect"
export const OUTER_CURATOR_ID = "outer:curator"
export const OUTER_ARBITER_ID = "outer:arbiter"

/** OpenCode agent id (= registry profile, send_message recipient). */
export const LEAD_OPENCODE = "lead"
export const ARCHITECT_OPENCODE = "architect"
export const CURATOR_OPENCODE = "curator"
export const ARBITER_OPENCODE = "arbiter"

export const INNER_EXECUTION_AGENT = "build"
/** Empty-context skill extraction session (post-retro). */
export const INNER_EXTRACT_AGENT = "build-extract"
/** Isolated skill verifier session (after extract record). */
export const INNER_VERIFY_AGENT = "build-verify"
/** Empty-context retro analyst — reads execution context and writes retro-summary for architect review. */
export const RETRO_ANALYST_AGENT = "retro-analyst"

export const INNER_PROFILES = [INNER_EXECUTION_AGENT] as const

export const GATEHOUSE_OUTER_AGENTS = new Set([
  LEAD_OPENCODE,
  ARCHITECT_OPENCODE,
  CURATOR_OPENCODE,
  ARBITER_OPENCODE,
])

export type RegistryScope = "outer" | "inner" | "retro" | "extract" | "verify"
export type RegistryStatus = "active" | "completed" | "error"

export type RegistryAgent = {
  agentId: string
  scope: RegistryScope
  /** OpenCode agent id (lead / architect / build / …). */
  profile: string
  sessionId: string
  displayName: string
  missionId?: string
  nodeId?: string
  projectRootSessionId?: string
  status: RegistryStatus
  createdAt: string
  updatedAt: string
}

export type RegistryPendingDelivery = {
  id: string
  recipientSessionId: string
  recipientAgentId: string
  senderAgentId?: string
  promptText: string
  /** Optional OpenCode profile override for the queued prompt. */
  promptProfile?: string
  createdAt: string
  attempts?: number
  lastAttemptAt?: string
  lastError?: string
  nextRetryAt?: string
}

export type RegistryRetroRun = {
  missionId: string
  startedAt: string
  retroSummarySubmittedAt?: string
  retroSummaryPath?: string
  architectNotifiedAt?: string
  /** Set when profile architect calls gatehouse_retro_summary_record. */
  architectLeadNotifiedAt?: string
  /** Set when Gatehouse auto-notifies profile lead that retro summaries are complete. */
  leadRetroSummaryNotifiedAt?: string
}

export type RegistrySkillExtractRun = {
  missionId: string
  expectedNodeIds: string[]
  startedAt: string
  verifyStartedAt?: string
  curatorNotifiedAt?: string
  /** Set when profile curator calls gatehouse_skill_summary_record. */
  curatorLeadNotifiedAt?: string
}

export type RegistrySkillVerifyRun = {
  missionId: string
  expectedNodeIds: string[]
  startedAt: string
}

export type RegistrySkillVerifyCompletion = {
  missionId: string
  nodeId: string
  sessionId: string
  completedAt: string
  passed: boolean
  reportPath?: string
}

export type RegistrySkillExtractCompletion = {
  missionId: string
  nodeId: string
  summaryPath?: string
  sessionId: string
  completedAt: string
}

/** Frozen mission contract in registry.db (active snapshot at mission_start). */
export type RegistryMissionRecord = {
  missionId: string
  status: string
  objective?: string
  doneWhen: string[]
  mustNot: string[]
  notes?: string
  userTopology?: string
  userSkill?: string
  startedAt?: string
  completedAt?: string
  isActive: boolean
  lockedAt: string
  updatedAt: string
  /** Raw frozen missions.yaml entry (structured done_when preserved). */
  contractRawJson?: unknown
}

export type RegistrySnapshot = {
  schemaVersion: number
  updatedAt: string
  agents: RegistryAgent[]
  pendingDeliveries: RegistryPendingDelivery[]
  retroRuns: RegistryRetroRun[]
  skillExtractRuns: RegistrySkillExtractRun[]
  skillExtractCompletions: RegistrySkillExtractCompletion[]
  skillVerifyRuns: RegistrySkillVerifyRun[]
  skillVerifyCompletions: RegistrySkillVerifyCompletion[]
}

export type RegisterAgentInput = {
  agentId: string
  scope: RegistryScope
  profile: string
  sessionId: string
  displayName: string
  missionId?: string
  nodeId?: string
  projectRootSessionId?: string
  status?: RegistryStatus
}

export type SendMessageInput = {
  senderSessionId: string
  senderAgentId?: string
  senderProfile?: string
  recipientQuery: string
  message: string
}

/** System-initiated delivery (e.g. execution_complete → lead); bypasses outer send policy. */
export type DeliverSystemNotificationInput = {
  senderSessionId: string
  senderAgentId?: string
  recipientQuery: string
  message: string
}

export type SendMessageResult =
  | { status: "sent"; recipient: RegistryAgent; sessionId: string; createdSession: boolean }
  | { status: "queued"; recipient: RegistryAgent; sessionId: string; createdSession: boolean }
  | { status: "not_found"; query: string; candidates: RegistryAgent[] }
  | { status: "ambiguous"; query: string; candidates: RegistryAgent[] }
  | { status: "self"; recipient: RegistryAgent }
  | { status: "forbidden"; reason: string; sender?: RegistryAgent; recipient?: RegistryAgent }
  | { status: "failed"; recipient: RegistryAgent; error: string }

export function innerAgentId(missionId: string, nodeId: string) {
  return `inner:${missionId}:${nodeId}`
}

export function retroAgentId(missionId: string) {
  return `retro:${missionId}`
}

export function extractAgentId(missionId: string, nodeId: string) {
  return `extract:${missionId}:${nodeId}`
}

export function verifyAgentId(missionId: string, nodeId: string) {
  return `verify:${missionId}:${nodeId}`
}
