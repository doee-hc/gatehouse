import type { PluginInput } from "@opencode-ai/plugin"
import type { GatehouseClient } from "../session/client.ts"
import type {
  RegisterAgentInput,
  RegistryAgent,
  RegistryPendingDelivery,
  RegistryRetroRun,
  RegistryScope,
  RegistrySkillExtractCompletion,
  RegistrySkillExtractRun,
  RegistrySkillVerifyCompletion,
  RegistrySkillVerifyRun,
} from "./types.ts"

export type StoreOptions = {
  directory: string
  client: GatehouseClient
  plugin?: PluginInput
}

export type ResolveOptions = {
  missionId?: string
  scope?: RegistryScope
  sender?: RegistryAgent
}

export type RecipientResolution =
  | { status: "resolved"; recipient: RegistryAgent; matchedBy: "agentId" | "sessionId" | "profile" | "displayName" | "nodeId" }
  | { status: "not_found"; query: string; candidates: RegistryAgent[] }
  | { status: "ambiguous"; query: string; candidates: RegistryAgent[] }

/** Mutable registry state shared by extracted services. */
export type RegistryState = {
  agents: Map<string, RegistryAgent>
  pendingDeliveries: RegistryPendingDelivery[]
  retroRuns: Map<string, RegistryRetroRun>
  skillExtractRuns: Map<string, RegistrySkillExtractRun>
  skillExtractCompletions: Map<string, RegistrySkillExtractCompletion>
  skillVerifyRuns: Map<string, RegistrySkillVerifyRun>
  skillVerifyCompletions: Map<string, RegistrySkillVerifyCompletion>
  flushTail: Promise<void>
}

/** Internal surface passed to extracted registry services. */
export type RegistryHost = {
  readonly directory: string
  readonly options: StoreOptions
  readonly state: RegistryState
  mutate<T>(fn: () => T): T
  loadSnapshot(): void
  removeAgent(agentId: string): void
  register(input: RegisterAgentInput): RegistryAgent
  byAgentId(agentId: string): RegistryAgent | undefined
  bySession(sessionId: string): RegistryAgent | undefined
  byProfile(profile: string, scope?: RegistryScope): RegistryAgent | undefined
  getActiveMission(): import("./types.ts").RegistryMissionRecord | undefined
  resolveRecipient(query: string, opts?: ResolveOptions): RecipientResolution
}
