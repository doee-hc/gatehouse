import type { PortalSnapshot } from "../api/types.ts"
import type { AgentStatus } from "../office/dom-labels.ts"

const liveBySpawn = new Map<string, AgentStatus>()

export function noteAgentActivity(spawnId: string, status: AgentStatus) {
  liveBySpawn.set(spawnId, status)
}

export function agentActivityFor(spawnId: string) {
  return liveBySpawn.get(spawnId)
}

export function eachAgentActivity(visitor: (spawnId: string, status: AgentStatus) => void) {
  for (const [spawnId, status] of liveBySpawn) visitor(spawnId, status)
}

/** Live SSE wins for in-flight work; snapshot idle wins when a session has finished. */
export function resolveAgentDisplayStatus(input: {
  spawnId: string
  snapshotStatus: AgentStatus
}) {
  const live = agentActivityFor(input.spawnId)
  if (!live) return input.snapshotStatus
  if (input.snapshotStatus === "idle") return "idle"
  if (live === "idle") return "idle"
  return live
}

export function setLiveAgentStatus(spawnId: string, status: AgentStatus) {
  noteAgentActivity(spawnId, status)
}

export function resetLiveAgentStatus() {
  liveBySpawn.clear()
}

export function anyAgentWorking(snapshot: PortalSnapshot) {
  const seen = new Set<string>()
  for (const agent of snapshot.agents) {
    seen.add(agent.spawn_id)
    const status = resolveAgentDisplayStatus({
      spawnId: agent.spawn_id,
      snapshotStatus: agent.status,
    })
    if (status === "busy" || status === "research") return true
  }
  for (const [spawnId, status] of liveBySpawn) {
    if (!seen.has(spawnId) && (status === "busy" || status === "research")) return true
  }
  return false
}
