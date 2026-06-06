import { connectPortalEvents } from "../bridge/events.ts"
import { truncateLabel } from "../bridge/map-sidebar.ts"
import { getOfficeScene, handleAgentChatEvent } from "../office/game.ts"
import { logEvent } from "../shell/event-log.ts"
import { agentStatusLabel, t } from "../shell/i18n.ts"
import { getPortalSnapshot } from "./state.ts"
import { trackAgentStatus } from "./session-activity.ts"
import { notePortalEventStreamReady } from "./snapshot-sync.ts"

const lastLoggedStatus = new Map<string, "idle" | "busy" | "research">()

function agentDisplayName(spawnId: string) {
  const snapshot = getPortalSnapshot()
  const record = snapshot?.agents.find((item) => item.spawn_id === spawnId)
  if (record) return record.display_name
  for (const tree of snapshot?.trees ?? (snapshot?.tree ? [snapshot.tree] : [])) {
    const node = tree.nodes.find((item) => item.node_id.replace(/[^a-zA-Z0-9_-]/g, "-") === spawnId)
    if (node) return node.display_name
  }
  return spawnId
}

export function startPortalLiveSync() {
  return connectPortalEvents({
    onPortalEvent: (event) => {
      notePortalEventStreamReady()
      if (event.type === "ping") return
      if (event.type === "agent.move") {
        const scene = getOfficeScene()
        scene?.agents.get(event.agentId)?.walkTo({ x: event.x, y: event.y }, scene.blocked)
        return
      }
      if (event.type === "agent.status") {
        if (!trackAgentStatus(event.agentId, event.status)) return
        if (lastLoggedStatus.get(event.agentId) === event.status) return
        lastLoggedStatus.set(event.agentId, event.status)
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
      if (event.type !== "agent.chat") return
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
    },
  })
}
