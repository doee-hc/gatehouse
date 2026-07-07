import { skillExtractCompletionKey, skillVerifyCompletionKey, now } from "./helpers.ts"
import type { RegistryState } from "./internals.ts"
import { REGISTRY_SCHEMA_VERSION, type RegisterAgentInput, type RegistryAgent, type RegistrySnapshot } from "./types.ts"

export function createEmptyRegistryState(): RegistryState {
  return {
    agents: new Map(),
    pendingDeliveries: [],
    retroRuns: new Map(),
    skillExtractRuns: new Map(),
    skillExtractCompletions: new Map(),
    skillVerifyRuns: new Map(),
    skillVerifyCompletions: new Map(),
    flushTail: Promise.resolve(),
  }
}

export function hydrateRegistryState(state: RegistryState, snapshot: RegistrySnapshot) {
  state.agents = new Map(snapshot.agents.map((item) => [item.agentId, item]))
  state.pendingDeliveries = snapshot.pendingDeliveries
  state.retroRuns = new Map(snapshot.retroRuns.map((item) => [item.missionId, item]))
  state.skillExtractRuns = new Map(snapshot.skillExtractRuns.map((item) => [item.missionId, item]))
  state.skillExtractCompletions = new Map(
    snapshot.skillExtractCompletions.map((item) => [skillExtractCompletionKey(item.missionId, item.nodeId), item]),
  )
  state.skillVerifyRuns = new Map(snapshot.skillVerifyRuns.map((item) => [item.missionId, item]))
  state.skillVerifyCompletions = new Map(
    snapshot.skillVerifyCompletions.map((item) => [skillVerifyCompletionKey(item.missionId, item.nodeId), item]),
  )
}

export function registryMemorySnapshot(state: RegistryState): RegistrySnapshot {
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    updatedAt: now(),
    agents: Array.from(state.agents.values()),
    pendingDeliveries: [...state.pendingDeliveries],
    retroRuns: Array.from(state.retroRuns.values()),
    skillExtractRuns: Array.from(state.skillExtractRuns.values()),
    skillExtractCompletions: Array.from(state.skillExtractCompletions.values()),
    skillVerifyRuns: Array.from(state.skillVerifyRuns.values()),
    skillVerifyCompletions: Array.from(state.skillVerifyCompletions.values()),
  }
}

export function registerAgentInState(state: RegistryState, input: RegisterAgentInput): RegistryAgent {
  const updatedAt = now()
  const record: RegistryAgent = {
    agentId: input.agentId,
    scope: input.scope,
    profile: input.profile,
    sessionId: input.sessionId,
    displayName: input.displayName,
    status: input.status ?? "active",
    createdAt: state.agents.get(input.agentId)?.createdAt ?? updatedAt,
    updatedAt,
    ...(input.missionId && { missionId: input.missionId }),
    ...(input.nodeId && { nodeId: input.nodeId }),
    ...(input.projectRootSessionId && { projectRootSessionId: input.projectRootSessionId }),
  }
  state.agents.set(input.agentId, record)
  return record
}
