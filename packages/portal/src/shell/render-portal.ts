import type { PortalSnapshot } from "../api/types.ts"
import { isQuietOffice, resolvePortalActivity, type PortalActivity } from "../portal/portal-activity.ts"
import { getBlogSnapshot, getPortalSnapshot } from "../portal/state.ts"
import { refreshAgentOverlay } from "./agent-overlay.ts"
import { renderBlog } from "./blog.ts"
import { localeTag, t } from "./i18n.ts"
import { renderKnowledge } from "./knowledge.ts"
import { renderMissions } from "./office-sidebar.ts"
import { renderOrchestrationPanel } from "./render-orchestration.ts"

export function renderPortal(snapshot: PortalSnapshot) {
  renderNavStatus(snapshot)
  renderOffice(snapshot)
  renderKnowledge(snapshot)
  renderBlog(getBlogSnapshot())
  refreshAgentOverlay()
}

export function refreshPortalActivityUi() {
  const snapshot = getPortalSnapshot()
  if (snapshot) renderNavStatus(snapshot)
}

function renderNavStatus(snapshot: PortalSnapshot) {
  const activity = resolvePortalActivity(snapshot)
  const statusLabel = document.getElementById("nav-status-label")
  if (statusLabel) {
    statusLabel.textContent = formatNavStatusLabel(snapshot, activity)
  }

  const liveDot = document.getElementById("nav-live-dot")
  if (liveDot) {
    liveDot.className = `live-dot ${activityDotClass(activity)}`
  }

  const navStatus = document.querySelector(".nav-status")
  if (navStatus) {
    navStatus.className = `nav-status nav-activity-${activity}`
  }
}

function formatNavStatusLabel(snapshot: PortalSnapshot, activity: PortalActivity) {
  const activityLabel = t(`nav.activity.${activity}`)
  if (snapshot.project) return t("nav.status", { project: snapshot.project, activity: activityLabel })
  return activityLabel
}

function activityDotClass(activity: PortalActivity) {
  if (activity === "live") return "live"
  if (activity === "retro") return "retro"
  if (activity === "offline") return "offline"
  return "standby"
}

function renderOffice(snapshot: PortalSnapshot) {
  const running = snapshot.missions.filter(
    (mission) => mission.status === "running" || mission.status === "retro",
  )
  const quiet = isQuietOffice(snapshot)

  const escMission = document.getElementById("esc-mission")
  if (escMission) {
    if (running.length === 0) {
      escMission.textContent = snapshot.lingering_mission_id
        ? t("esc.missionLingering", { id: snapshot.lingering_mission_id })
        : t("esc.missionEmpty")
    } else {
      const id = snapshot.active_mission_id ?? running[0]!.id
      escMission.textContent = t("esc.mission", { id })
    }
  }

  const clock = document.getElementById("esc-time")
  if (clock) {
    clock.textContent = new Date().toLocaleTimeString(localeTag(), { hour: "2-digit", minute: "2-digit" })
  }

  renderMissions(snapshot)
  renderOrchestrationPanel(snapshot)

  const eventLog = document.getElementById("event-log")
  if (eventLog && eventLog.children.length === 0) {
    if (snapshot.opencode_reachable === false) {
      eventLog.innerHTML = `<p class="empty-state">${escapeHtml(t("empty.opencodeOffline"))}</p>`
      return
    }
    eventLog.innerHTML = quiet
      ? `<p class="empty-state quiet">${escapeHtml(
          snapshot.lingering_mission_id ? t("empty.quietOfficeLingering") : t("empty.quietOffice"),
        )}</p>`
      : `<p class="empty-state">${escapeHtml(t("empty.waitingEvents"))}</p>`
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
