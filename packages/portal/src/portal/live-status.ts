import type { AgentStatus } from "../office/dom-labels.ts"

const liveBySpawn = new Map<string, AgentStatus>()

export function noteAgentActivity(spawnId: string, status: AgentStatus) {
  if (status === "idle") liveBySpawn.delete(spawnId)
  else liveBySpawn.set(spawnId, status)
}

export function agentActivityFor(spawnId: string) {
  return liveBySpawn.get(spawnId)
}

export function eachAgentActivity(visitor: (spawnId: string, status: AgentStatus) => void) {
  for (const [spawnId, status] of liveBySpawn) visitor(spawnId, status)
}

/** SSE activity wins over snapshot between polls. */
export function resolveAgentDisplayStatus(input: {
  spawnId: string
  snapshotStatus: AgentStatus
}) {
  return agentActivityFor(input.spawnId) ?? input.snapshotStatus
}

export function setLiveAgentStatus(spawnId: string, status: AgentStatus) {
  noteAgentActivity(spawnId, status)
}

export function resetLiveAgentStatus() {
  liveBySpawn.clear()
}
