import type { PortalMission, PortalSnapshot } from "../api/types.ts"
import { truncateLabel } from "../bridge/map-sidebar.ts"
import { missionStatusLabel, localeTag, t } from "./i18n.ts"

export { truncateLabel }

const missionOpen = new Map<string, boolean>()
let missionListInitialized = false

export function bindOfficeSidebar() {
  const host = document.getElementById("missions-host")
  if (!host || host.dataset.mapWired === "1") return
  host.dataset.mapWired = "1"
  host.addEventListener("toggle", (event) => {
    const target = event.target
    if (!(target instanceof HTMLDetailsElement)) return
    const missionId = target.getAttribute("data-mission-id")
    if (missionId) missionOpen.set(missionId, target.open)
  })
}

export function renderDirection(snapshot: PortalSnapshot) {
  const host = document.getElementById("direction-host")
  if (!host) return

  const direction = snapshot.direction
  if (!direction || (!direction.summary?.trim() && direction.constraints.length === 0)) {
    host.innerHTML = `<p class="empty-state">${escapeHtml(t("empty.noDirection"))}</p>`
    return
  }

  const statusLabel = direction.confirmed
    ? t("direction.status.confirmed")
    : t("direction.status.draft")
  const statusClass = direction.confirmed ? "tag-done" : "tag-draft"
  const reviewAfter = direction.review_after ? formatDirectionDate(direction.review_after) : ""

  host.innerHTML = `<div class="direction-card${direction.confirmed ? " confirmed" : " draft"}">
    <div class="direction-head">
      <span class="tag ${statusClass}">${escapeHtml(statusLabel)}</span>
      ${reviewAfter ? `<span class="direction-review">${escapeHtml(t("direction.reviewAfter"))} · ${escapeHtml(reviewAfter)}</span>` : ""}
    </div>
    ${direction.summary?.trim() ? `<p class="direction-summary">${escapeHtml(direction.summary.trim())}</p>` : ""}
    ${
      direction.constraints.length > 0
        ? `<ul class="direction-constraints">${direction.constraints
            .map((item) => `<li>${escapeHtml(item)}</li>`)
            .join("")}</ul>`
        : ""
    }
  </div>`
}

export function renderMissions(snapshot: PortalSnapshot) {
  const host = document.getElementById("missions-host")
  if (!host) return

  if (snapshot.missions.length === 0) {
    host.innerHTML = `<p class="empty-state">${escapeHtml(t("empty.noMissions"))}</p>`
    return
  }

  syncMissionOpenFromDom(host)
  host.innerHTML = sortMissionsNewestFirst(snapshot.missions)
    .map((mission) => renderMissionCard(mission, snapshot))
    .join("")
  missionListInitialized = true
}

function syncMissionOpenFromDom(host: HTMLElement) {
  for (const element of host.querySelectorAll<HTMLDetailsElement>("details.mission-card[data-mission-id]")) {
    const missionId = element.getAttribute("data-mission-id")
    if (missionId) missionOpen.set(missionId, element.open)
  }
}

function resolveMissionOpen(mission: PortalMission, snapshot: PortalSnapshot) {
  if (missionOpen.has(mission.id)) return missionOpen.get(mission.id)!
  if (!missionListInitialized) {
    return mission.status === "running" || mission.status === "retro"
  }
  return false
}

function sortMissionsNewestFirst(missions: PortalMission[]) {
  return missions
    .map((mission, index) => ({ mission, index }))
    .sort((a, b) => {
      const diff = missionSortTime(b.mission) - missionSortTime(a.mission)
      if (diff !== 0) return diff
      return b.index - a.index
    })
    .map(({ mission }) => mission)
}

function missionSortTime(mission: PortalMission) {
  const value = mission.completed_at ?? mission.started_at
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

function renderMissionCard(mission: PortalMission, snapshot: PortalSnapshot) {
  const time = formatMissionTime(mission)
  const focused =
    mission.id === snapshot.active_mission_id &&
    (mission.status === "running" || mission.status === "retro")
  const active = mission.status === "running" || mission.status === "retro"
  return `<details class="mission-card${focused ? " focused" : ""}${active ? ` active ${mission.status}` : ""}" data-mission-id="${escapeHtml(mission.id)}" ${resolveMissionOpen(mission, snapshot) ? "open" : ""}>
    <summary class="mission-summary">
      <span class="mission-summary-title" title="${escapeHtml(mission.id)}">${escapeHtml(truncateLabel(mission.id, 22))}</span>
      <span class="mission-summary-meta">
        <span class="tag ${missionStatusTagClass(mission.status)}">${escapeHtml(missionStatusLabel(mission.status))}</span>
        ${time ? `<span class="mission-time">${escapeHtml(time)}</span>` : ""}
      </span>
    </summary>
    ${mission.objective ? `<div class="mission-body"><p class="mission-objective">${escapeHtml(mission.objective)}</p></div>` : ""}
  </details>`
}

function formatMissionTime(mission: PortalMission) {
  const value = mission.completed_at ?? mission.started_at
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(localeTag(), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatDirectionDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(localeTag(), { year: "numeric", month: "short", day: "numeric" })
}

function missionStatusTagClass(status: string) {
  if (status === "running") return "tag-running"
  if (status === "retro") return "tag-retro"
  if (status === "queued") return "tag-queued"
  if (status === "done" || status === "completed") return "tag-done"
  return "tag-muted"
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
