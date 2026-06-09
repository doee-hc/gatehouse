import type { AgentStatus } from "../office/dom-labels.ts"

const lastLoggedStatus = new Map<string, AgentStatus>()

export function noteLoggedAgentStatus(spawnId: string, status: AgentStatus) {
  lastLoggedStatus.set(spawnId, status)
}

export function shouldLogAgentStatus(spawnId: string, status: AgentStatus) {
  if (lastLoggedStatus.get(spawnId) === status) return false
  lastLoggedStatus.set(spawnId, status)
  return true
}
