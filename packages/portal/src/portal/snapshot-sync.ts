import type { PortalSnapshot } from "../api/types.ts"
import { t } from "../shell/i18n.ts"
import { clearEventLogPlaceholder, logEvent } from "../shell/event-log.ts"
import {
  applyPortalSnapshot,
  prefetchOfficeLayoutGeneration,
  reloadOfficeLayoutIfNeeded,
} from "../office/game.ts"
import { replaySessionActivity, syncAgentsFromSnapshotStatus } from "./session-activity.ts"
import { logSnapshotDiff } from "./snapshot-events.ts"
import { getPortalSnapshot, setPortalSnapshot } from "./state.ts"

let lastOpencodeReachable: boolean | undefined
let loggedPortalStream = false

export function applySnapshotUpdate(next: PortalSnapshot) {
  const prev = getPortalSnapshot()
  if (prev) logSnapshotDiff(prev, next)

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
