import { applyLiveAgentStatus, getOfficeScene } from "../office/game.ts"
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
  const scene = getOfficeScene()
  if (!scene) return
  for (const agent of agents) {
    const status = resolveAgentDisplayStatus({
      spawnId: agent.spawn_id,
      snapshotStatus: agent.status,
    })
    scene.setAgentStatus(agent.spawn_id, status)
  }
}
