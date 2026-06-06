import type { PortalAgent, PortalSnapshot } from "../api/types.ts"
import { agentStatusLabel, t } from "../shell/i18n.ts"
import { clearEventLogPlaceholder, logEvent } from "../shell/event-log.ts"
import {
  applyPortalSnapshot,
  prefetchOfficeLayoutGeneration,
  reloadOfficeLayoutIfNeeded,
} from "../office/game.ts"
import { replaySessionActivity, syncAgentsFromSnapshotStatus } from "./session-activity.ts"
import { getPortalSnapshot, setPortalSnapshot } from "./state.ts"

let lastOpencodeReachable: boolean | undefined
let loggedPortalStream = false

export function applySnapshotUpdate(next: PortalSnapshot) {
  const prev = getPortalSnapshot()
  if (prev && next.opencode_reachable !== true) {
    for (const agent of next.agents) {
      const before = prev.agents.find((item) => item.spawn_id === agent.spawn_id)
      if (before && before.status !== agent.status) logAgentStatus(agent, before.status)
    }
  }

  if (next.opencode_reachable !== lastOpencodeReachable) {
    lastOpencodeReachable = next.opencode_reachable
    logEvent(
      () =>
        t(next.opencode_reachable ? "event.opencodeConnected" : "event.opencodeDisconnected"),
      next.opencode_reachable ? "evt-live" : "evt-warn",
    )
  }

  setPortalSnapshot(next)
  replaySessionActivity()
  syncAgentsFromSnapshotStatus(next.agents)
  prefetchOfficeLayoutGeneration(prev, next)
  reloadOfficeLayoutIfNeeded(prev, next)
  applyPortalSnapshot(next)
}

export function notePortalEventStreamReady() {
  if (loggedPortalStream) return
  loggedPortalStream = true
  clearEventLogPlaceholder()
  logEvent(() => t("event.portalStreamReady"), "evt-live")
}

function logAgentStatus(agent: PortalAgent, before: PortalAgent["status"]) {
  clearEventLogPlaceholder()
  logEvent(
    () =>
      t("event.agentStatus", {
        name: agent.display_name,
        to: agentStatusLabel(agent.status),
      }),
    eventClass(agent.status),
  )
}

function eventClass(status: PortalAgent["status"]) {
  if (status === "research" || status === "busy") return "evt-busy"
  return "evt-msg"
}

