import { applyLiveAgentStatus } from "../office/game.ts"
import { eachAgentActivity, noteAgentActivity, resolveAgentDisplayStatus } from "./live-status.ts"
import type { PortalAgent } from "../api/types.ts"
import type { AgentStatus } from "../office/dom-labels.ts"

export function trackAgentStatus(spawnId: string, status: AgentStatus) {
  noteAgentActivity(spawnId, status)
  applyLiveAgentStatus(spawnId, status)
  return true
}

export function replaySessionActivity() {
  eachAgentActivity((spawnId, status) => {
    applyLiveAgentStatus(spawnId, status)
  })
}

export function syncAgentsFromSnapshotStatus(agents: PortalAgent[]) {
  for (const agent of agents) {
    applyLiveAgentStatus(
      agent.spawn_id,
      resolveAgentDisplayStatus({ spawnId: agent.spawn_id, snapshotStatus: agent.status }),
    )
  }
}
