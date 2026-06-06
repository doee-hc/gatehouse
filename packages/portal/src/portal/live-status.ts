import type { AgentStatus } from "../office/dom-labels.ts"

const liveBySpawn = new Map<string, AgentStatus>()
const sessionById = new Map<string, AgentStatus>()

export function noteSessionActivity(sessionId: string, status: AgentStatus) {
  if (status === "idle") sessionById.delete(sessionId)
  else sessionById.set(sessionId, status)
}

export function sessionActivityFor(sessionId: string) {
  return sessionById.get(sessionId)
}

export function eachSessionActivity(visitor: (sessionId: string, status: AgentStatus) => void) {
  for (const [sessionId, status] of sessionById) visitor(sessionId, status)
}

/** SSE session activity wins over snapshot between polls. */
export function resolveAgentDisplayStatus(input: {
  sessionId: string
  snapshotStatus: AgentStatus
}) {
  return sessionActivityFor(input.sessionId) ?? input.snapshotStatus
}

export function setLiveAgentStatus(spawnId: string, status: AgentStatus) {
  if (status === "idle") liveBySpawn.delete(spawnId)
  else liveBySpawn.set(spawnId, status)
}

export function resetLiveAgentStatus() {
  liveBySpawn.clear()
  sessionById.clear()
}
