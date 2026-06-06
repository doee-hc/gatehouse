import { applyLiveAgentStatus } from "../office/game.ts"
import { eachSessionActivity, noteSessionActivity, resolveAgentDisplayStatus } from "./live-status.ts"
import { getPortalSnapshot, spawnForSession } from "./state.ts"
import type { PortalAgent } from "../api/types.ts"
import type { AgentStatus } from "../office/dom-labels.ts"

export function trackSessionActivity(sessionId: string, status: AgentStatus) {
  noteSessionActivity(sessionId, status)
  const spawnId = spawnForSession(sessionId) ?? spawnForSessionFromSnapshot(sessionId)
  if (!spawnId) return false
  applyLiveAgentStatus(spawnId, status)
  return true
}

export function trackAgentStatus(spawnId: string, status: AgentStatus) {
  const sessionId = getPortalSnapshot()?.agents.find((agent) => agent.spawn_id === spawnId)?.session_id
  if (sessionId) noteSessionActivity(sessionId, status)
  applyLiveAgentStatus(spawnId, status)
  return true
}

function spawnForSessionFromSnapshot(sessionId: string) {
  return getPortalSnapshot()?.agents.find((agent) => agent.session_id === sessionId)?.spawn_id
}

export function replaySessionActivity() {
  eachSessionActivity((sessionId, status) => {
    const spawnId = spawnForSession(sessionId) ?? spawnForSessionFromSnapshot(sessionId)
    if (!spawnId) return
    applyLiveAgentStatus(spawnId, status)
  })
}

export function syncAgentsFromSnapshotStatus(agents: PortalAgent[]) {
  for (const agent of agents) {
    applyLiveAgentStatus(
      agent.spawn_id,
      resolveAgentDisplayStatus({ sessionId: agent.session_id, snapshotStatus: agent.status }),
    )
  }
}
