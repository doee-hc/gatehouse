export const REGISTRY_SCHEMA_VERSION = 8

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
/** Structural root with delegates — coordinates the tree and notifies lead; task denied. */
export const INNER_ROOT_AGENT = "build-root"
/** Solo structural root (no children) — executes, may use task, notifies lead. */
export const INNER_ROOT_SOLO_AGENT = "build-root-solo"
/** Intermediate inner nodes with children — subtree coordination only; no lead contact. */
export const INNER_COORDINATOR_AGENT = "build-coordinator"

export const INNER_PROFILES = [
  INNER_ROOT_AGENT,
  INNER_ROOT_SOLO_AGENT,
  INNER_COORDINATOR_AGENT,
  INNER_EXECUTION_AGENT,
] as const

const INNER_LEAD_CONTACT_PROFILES = new Set<string>([INNER_ROOT_AGENT, INNER_ROOT_SOLO_AGENT])

export function innerProfileMayNotifyLead(profile: string) {
  return INNER_LEAD_CONTACT_PROFILES.has(profile)
}

export const GATEHOUSE_OUTER_AGENTS = new Set([
  LEAD_OPENCODE,
  ARCHITECT_OPENCODE,
  CURATOR_OPENCODE,
  ARBITER_OPENCODE,
])

export type RegistryScope = "outer" | "inner" | "retro"
export type RegistryStatus = "active" | "completed" | "error"

export type RegistryAgent = {
  agentId: string
  scope: RegistryScope
  /** OpenCode agent id (lead / architect / build-root / build-coordinator / build / …). */
  profile: string
  sessionId: string
  displayName: string
  missionId?: string
  nodeId?: string
  parentSessionId?: string
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
  expectedNodeIds: string[]
  startedAt: string
  architectNotifiedAt?: string
  /** Set when profile architect send_message(recipient=lead) after retro batch kickoff. */
  architectLeadNotifiedAt?: string
}

export type RegistryRetroCompletion = {
  missionId: string
  nodeId: string
  reportPath: string
  sessionId: string
  completedAt: string
}

export type RegistrySkillExtractRun = {
  missionId: string
  expectedNodeIds: string[]
  startedAt: string
  curatorNotifiedAt?: string
  /** Set when profile curator send_message(recipient=lead) after skill-extract batch kickoff. */
  curatorLeadNotifiedAt?: string
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
  priority?: string
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
  retroCompletions: RegistryRetroCompletion[]
  skillExtractRuns: RegistrySkillExtractRun[]
  skillExtractCompletions: RegistrySkillExtractCompletion[]
}

export type RegisterAgentInput = {
  agentId: string
  scope: RegistryScope
  profile: string
  sessionId: string
  displayName: string
  missionId?: string
  nodeId?: string
  parentSessionId?: string
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

export function isInnerStructuralRoot(agent: RegistryAgent) {
  return agent.scope === "inner" && !agent.parentSessionId
}

export function retroAgentId(missionId: string, nodeId: string) {
  return `retro:${missionId}:${nodeId}`
}
