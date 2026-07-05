import { connectPortalEvents } from "../bridge/events.ts"
import { truncateLabel } from "../bridge/map-sidebar.ts"
import { getOfficeScene, handleAgentChatEvent } from "../office/game.ts"
import { logEvent } from "../shell/event-log.ts"
import { t } from "../shell/i18n.ts"
import { refreshPortalActivityUi } from "../shell/render-portal.ts"
import { getPortalSnapshot } from "./state.ts"
import { trackAgentStatus } from "./session-activity.ts"
import { logBlogPublishedEvent, logBlogUnpublishedEvent } from "./snapshot-events.ts"
import { notePortalEventStreamReady } from "./snapshot-sync.ts"
import { shouldLogAgentStatus } from "./status-log.ts"

let stopLiveSync: (() => void) | undefined

function agentDisplayName(spawnId: string) {
  const snapshot = getPortalSnapshot()
  const record = snapshot?.agents.find((item) => item.spawn_id === spawnId)
  if (record) return record.display_name
  for (const team of snapshot?.team ? [snapshot.team] : []) {
    const node = team.nodes.find((item) => item.node_id.replace(/[^a-zA-Z0-9_-]/g, "-") === spawnId)
    if (node) return node.display_name
  }
  return spawnId
}

export function startPortalLiveSync() {
  if (stopLiveSync) return stopLiveSync

  stopLiveSync = connectPortalEvents({
    onPortalEvent: (event) => {
      notePortalEventStreamReady()
      if (event.type === "ping") return
      if (event.type === "agent.move") {
        const scene = getOfficeScene()
        const agent = scene?.agents.get(event.agentId)
        if (agent && scene && !agent.fixed) agent.walkTo({ x: event.x, y: event.y }, scene.blocked)
        return
      }
      if (event.type === "agent.status") {
        if (!trackAgentStatus(event.agentId, event.status)) return
        refreshPortalActivityUi()
        if (!shouldLogAgentStatus(event.agentId, event.status)) return
        const name = agentDisplayName(event.agentId)
        if (event.status === "research") {
          logEvent(() => t("event.sessionResearch", { name }), "evt-busy")
          return
        }
        if (event.status === "busy") {
          logEvent(() => t("event.sessionBusy", { name }), "evt-busy")
          return
        }
        logEvent(() => t("event.sessionIdle", { name }), "evt-msg")
        return
      }
      if (event.type === "agent.chat") {
        handleAgentChatEvent(event.fromSpawnId, event.toSpawnId, event.text)
        logEvent(
          () =>
            t("event.agentChat", {
              from: agentDisplayName(event.fromSpawnId),
              to: agentDisplayName(event.toSpawnId),
              text: truncateLabel(event.text, 40),
            }),
          "event-chat",
        )
        return
      }
      if (event.type === "blog.publish") {
        logBlogPublishedEvent(event.postId, event.title?.trim() || event.postId)
        return
      }
      if (event.type === "blog.unpublish") {
        logBlogUnpublishedEvent(event.postId, event.title?.trim() || event.postId)
      }
    },
    onStreamDisconnect: () => {
      logEvent(() => t("event.portalStreamDisconnected"), "evt-warn")
    },
    onStreamReconnect: () => {
      logEvent(() => t("event.portalStreamReconnected"), "evt-live")
    },
  })

  return stopLiveSync
}
