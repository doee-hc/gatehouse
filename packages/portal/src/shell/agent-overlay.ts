import {
  type AgentSelectionDetail,
  onAgentSelectedFromMap,
  emitAgentSelectionCleared,
} from "../bridge/map-sidebar.ts"
import { getPortalSnapshot } from "../portal/state.ts"
import { resolveAgentDisplayStatus } from "../portal/live-status.ts"
import { agentDetailDescription, agentStatusLabel, t } from "./i18n.ts"

let lastSelection: AgentSelectionDetail | undefined
let overlayBound = false

export function bindAgentOverlay() {
  if (overlayBound) return
  overlayBound = true
  onAgentSelectedFromMap((detail) => {
    lastSelection = detail
    renderAgentOverlay(detail)
  })
  document.addEventListener("pointerdown", (event) => {
    if (!lastSelection) return
    const target = event.target
    if (!(target instanceof Element)) return
    if (document.getElementById("agent-detail-panel")?.contains(target)) return
    if (target.closest(".office-agent-label")) return
    hideAgentOverlay()
  })
}

export function isAgentDetailPanelOpen(spawnId?: string) {
  const panel = document.getElementById("agent-detail-panel")
  if (!panel || panel.hidden || !lastSelection) return false
  if (spawnId && lastSelection.spawnId !== spawnId) return false
  return true
}

/** Update open panel content without showing it (e.g. live status from SSE). */
export function refreshAgentOverlayIfOpen(spawnId: string, status: string) {
  if (!isAgentDetailPanelOpen(spawnId)) return
  renderAgentOverlay({ ...lastSelection!, status })
}

export function refreshAgentOverlay() {
  if (!lastSelection) return
  const snapshot = getPortalSnapshot()
  const record = snapshot?.agents.find((agent) => agent.spawn_id === lastSelection!.spawnId)
  if (!record) {
    hideAgentOverlay()
    return
  }
  renderAgentOverlay({
    ...lastSelection,
    status: resolveAgentDisplayStatus({
      spawnId: record.spawn_id,
      snapshotStatus: record.status,
    }),
    ...(record.description && { description: record.description }),
    ...(record.skills && { skills: record.skills }),
  })
}

export function renderAgentOverlay(detail: AgentSelectionDetail) {
  const panel = document.getElementById("agent-detail-panel")
  if (!panel) return
  panel.hidden = false
  panel.classList.toggle("is-left", detail.panelSide === "left")
  panel.classList.toggle("is-right", detail.panelSide !== "left")

  const statusClass =
    detail.status === "busy" ? "busy" : detail.status === "research" ? "research" : "idle"
  const description = agentDetailDescription(detail)

  panel.innerHTML = `<div class="agent-detail-card">
    <div class="agent-detail-header">
      <div class="agent-detail-name">${escapeHtml(detail.name)}</div>
      <span class="agent-status-pill agent-status-${statusClass}">${escapeHtml(agentStatusLabel(detail.status))}</span>
    </div>
    ${
      description
        ? `<div class="agent-detail-section">
            <div class="agent-detail-label">${escapeHtml(t("agent.description"))}</div>
            <p class="agent-detail-text">${escapeHtml(description)}</p>
          </div>`
        : ""
    }
    ${
      detail.skills && detail.skills.length > 0
        ? `<div class="agent-detail-section">
            <div class="agent-detail-label">${escapeHtml(t("agent.skills"))}</div>
            <ul class="agent-detail-skills">
              ${detail.skills.map((skill) => `<li>${escapeHtml(skill)}</li>`).join("")}
            </ul>
          </div>`
        : ""
    }
    <div class="agent-detail-meta">${escapeHtml(detail.profile)} · ${escapeHtml(detail.scope)}</div>
  </div>`
}

export function hideAgentOverlay() {
  const panel = document.getElementById("agent-detail-panel")
  if (!panel || panel.hidden) return
  panel.hidden = true
  panel.classList.remove("is-left", "is-right")
  panel.innerHTML = ""
  lastSelection = undefined
  emitAgentSelectionCleared()
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
