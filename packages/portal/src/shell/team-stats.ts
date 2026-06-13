import { loadTeamStatsSnapshot } from "../api/team-stats.ts"
import type { TeamStatsMission, TeamStatsOuterRole, TeamStatsSnapshot } from "../api/types.ts"
import { isBackendConnected } from "../portal/connection.ts"
import { TEAM_STATS_POLL_HIDDEN_MS } from "../portal/poll-intervals.ts"
import { resolveTeamStatsPollMs } from "../portal/runtime-poll.ts"
import { startAdaptivePolling } from "../portal/poll-scheduler.ts"
import { getActiveView } from "./tabs.ts"
import { localeTag, missionStatusLabel, t } from "./i18n.ts"

let teamStatsBound = false
let currentSnapshot: TeamStatsSnapshot | undefined
let selectedMissionId: string | undefined
let loading = false

export function initTeamStats() {
  if (teamStatsBound) return
  teamStatsBound = true

  document.getElementById("stats-host")?.addEventListener("click", (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const card = target.closest("[data-mission-id]")
    if (!(card instanceof HTMLElement)) return
    const missionId = card.getAttribute("data-mission-id")
    if (!missionId) return
    selectedMissionId = selectedMissionId === missionId ? undefined : missionId
    if (currentSnapshot) renderTeamStats(currentSnapshot)
  })
}

export function renderTeamStats(snapshot?: TeamStatsSnapshot) {
  const host = document.getElementById("stats-host")
  if (!host) return

  if (snapshot) currentSnapshot = snapshot

  if (loading) {
    host.innerHTML = `<p class="empty-state">${escapeHtml(t("stats.loading"))}</p>`
    return
  }

  if (!currentSnapshot) {
    host.innerHTML = `<p class="empty-state">${escapeHtml(t("stats.empty"))}</p>`
    return
  }

  if (!currentSnapshot.opencode_reachable && isBackendConnected()) {
    host.innerHTML = `<p class="empty-state">${escapeHtml(t("empty.opencodeOffline"))}</p>`
    return
  }

  if (currentSnapshot.missions.length === 0 && currentSnapshot.outer.length === 0) {
    host.innerHTML = `<p class="empty-state">${escapeHtml(t("stats.empty"))}</p>`
    return
  }

  host.innerHTML = [
    renderUpdatedAt(currentSnapshot.updated_at),
    renderOuterSection(currentSnapshot.outer),
    renderMissionCharts(currentSnapshot.missions),
    renderMissionTable(currentSnapshot.missions),
  ].join("")
}

function summarizeTeamUsage(snapshot: TeamStatsSnapshot) {
  let tokens = 0
  let cost = 0
  for (const role of snapshot.outer) {
    tokens += role.tokens.total
    cost += role.cost
  }
  for (const mission of snapshot.missions) {
    tokens += mission.tokens.total
    cost += mission.cost
  }
  return { tokens, cost }
}

export function renderOfficeStatsTicker(snapshot?: TeamStatsSnapshot) {
  const host = document.getElementById("esc-stats-ticker")
  if (!host) return

  if (!snapshot?.opencode_reachable && isBackendConnected()) {
    host.hidden = true
    host.textContent = ""
    return
  }

  if (!snapshot) {
    host.hidden = true
    host.textContent = ""
    return
  }

  const usage = summarizeTeamUsage(snapshot)
  if (usage.tokens <= 0 && usage.cost <= 0) {
    host.hidden = true
    host.textContent = ""
    return
  }

  host.hidden = false
  host.textContent = t("stats.ticker", {
    tokens: formatTokens(usage.tokens),
    cost: formatCost(usage.cost),
  })
}

export function startTeamStatsPolling() {
  return startAdaptivePolling({
    intervalMs: resolveTeamStatsPollMs(),
    hiddenIntervalMs: TEAM_STATS_POLL_HIDDEN_MS,
    run: async () => {
      const view = getActiveView()
      if (view !== "office" && view !== "stats") return

      const snapshot = await loadTeamStatsSnapshot().catch(() => undefined)
      if (!snapshot) return

      if (view === "stats") {
        loading = false
        renderTeamStats(snapshot)
      }
      if (view === "office") renderOfficeStatsTicker(snapshot)
    },
  })
}

export async function refreshTeamStats() {
  if (loading) return
  loading = true
  renderTeamStats()
  const snapshot = await loadTeamStatsSnapshot().catch(() => undefined)
  loading = false
  if (!snapshot) {
    const host = document.getElementById("stats-host")
    if (host) host.innerHTML = `<p class="empty-state">${escapeHtml(t("stats.loadFailed"))}</p>`
    return
  }
  renderTeamStats(snapshot)
  if (getActiveView() === "office") renderOfficeStatsTicker(snapshot)
}

function renderUpdatedAt(value: string) {
  const time = new Date(value)
  const label = Number.isNaN(time.getTime())
    ? value
    : time.toLocaleString(localeTag(), { dateStyle: "medium", timeStyle: "short" })
  return `<p class="stats-updated">${escapeHtml(t("stats.updatedAt", { time: label }))}</p>`
}

function renderOuterSection(outer: TeamStatsOuterRole[]) {
  if (outer.length === 0) return ""

  const maxTokens = Math.max(...outer.map((role) => role.tokens.total), 1)
  const totalCost = outer.reduce((sum, role) => sum + role.cost, 0)
  const totalDuration = outer.reduce((sum, role) => sum + role.duration_ms, 0)

  return `<section class="stats-panel">
    <div class="stats-panel-head">
      <h3>${escapeHtml(t("stats.outerTitle"))}</h3>
      <p>${escapeHtml(t("stats.outerSubtitle"))}</p>
    </div>
    <div class="stats-summary-row">
      <span>${escapeHtml(t("stats.totalCost"))}: ${escapeHtml(formatCost(totalCost))}</span>
      <span>${escapeHtml(t("stats.totalDuration"))}: ${escapeHtml(formatDuration(totalDuration))}</span>
    </div>
    <div class="stats-chart">
      <div class="stats-chart-title">${escapeHtml(t("stats.chartTokens"))}</div>
      ${outer
        .map(
          (role) => `
        <div class="stats-bar-row">
          <span class="stats-bar-label outer-${escapeHtml(role.profile)}">${escapeHtml(role.label)}</span>
          <div class="stats-bar-track"><div class="stats-bar-fill outer-${escapeHtml(role.profile)}" style="width:${barWidth(role.tokens.total, maxTokens)}"></div></div>
          <span class="stats-bar-value">${escapeHtml(formatTokens(role.tokens.total))}</span>
        </div>`,
        )
        .join("")}
    </div>
  </section>`
}

function renderMissionCharts(missions: TeamStatsMission[]) {
  if (missions.length === 0) return ""

  const maxTokens = Math.max(...missions.map((mission) => mission.tokens.total), 1)
  const maxCost = Math.max(...missions.map((mission) => mission.cost), 0.000_001)
  const maxDuration = Math.max(...missions.map((mission) => mission.duration_ms), 1)

  return `<section class="stats-panel">
    <div class="stats-panel-head">
      <h3>${escapeHtml(t("stats.missionTitle"))}</h3>
      <p>${escapeHtml(t("stats.missionSubtitle"))}</p>
    </div>
    <div class="stats-chart-grid">
      ${renderComparisonChart(t("stats.chartTokens"), missions, (mission) => mission.tokens.total, maxTokens, formatTokens)}
      ${renderComparisonChart(t("stats.chartCost"), missions, (mission) => mission.cost, maxCost, formatCost)}
      ${renderComparisonChart(t("stats.chartDuration"), missions, (mission) => mission.duration_ms, maxDuration, formatDuration)}
    </div>
  </section>`
}

function renderComparisonChart(
  title: string,
  missions: TeamStatsMission[],
  value: (mission: TeamStatsMission) => number,
  max: number,
  format: (amount: number) => string,
) {
  return `<div class="stats-chart">
    <div class="stats-chart-title">${escapeHtml(title)}</div>
    ${missions
      .map(
        (mission) => `
      <div class="stats-bar-row">
        <span class="stats-bar-label">${escapeHtml(mission.id)}</span>
        <div class="stats-bar-track"><div class="stats-bar-fill mission" style="width:${barWidth(value(mission), max)}"></div></div>
        <span class="stats-bar-value">${escapeHtml(format(value(mission)))}</span>
      </div>`,
      )
      .join("")}
  </div>`
}

function renderMissionTable(missions: TeamStatsMission[]) {
  if (missions.length === 0) return ""

  return `<section class="stats-panel">
    <div class="stats-panel-head">
      <h3>${escapeHtml(t("stats.detailTitle"))}</h3>
      <p>${escapeHtml(t("stats.detailSubtitle"))}</p>
    </div>
    <div class="stats-mission-list">
      ${missions.map((mission) => renderMissionCard(mission)).join("")}
    </div>
  </section>`
}

function renderMissionCard(mission: TeamStatsMission) {
  const open = selectedMissionId === mission.id
  const maxRoleTokens = Math.max(...mission.roles.map((role) => role.tokens.total), 1)

  return `<article class="stats-mission-card${open ? " open" : ""}" data-mission-id="${escapeHtml(mission.id)}">
    <div class="stats-mission-head">
      <div>
        <h4>${escapeHtml(mission.id)}</h4>
        ${mission.objective ? `<p>${escapeHtml(mission.objective)}</p>` : ""}
      </div>
      <span class="tag ${missionStatusClass(mission.status)}">${escapeHtml(missionStatusLabel(mission.status))}</span>
    </div>
    <div class="stats-mission-metrics">
      <span>${escapeHtml(t("stats.metricTokens"))}: ${escapeHtml(formatTokens(mission.tokens.total))}</span>
      <span>${escapeHtml(t("stats.metricCost"))}: ${escapeHtml(formatCost(mission.cost))}</span>
      <span>${escapeHtml(t("stats.metricDuration"))}: ${escapeHtml(formatDuration(mission.duration_ms))}</span>
      ${
        mission.wall_clock_ms
          ? `<span>${escapeHtml(t("stats.metricWallClock"))}: ${escapeHtml(formatDuration(mission.wall_clock_ms))}</span>`
          : ""
      }
    </div>
    ${
      open
        ? mission.roles.length > 0
          ? `<div class="stats-role-chart">
              <div class="stats-chart-title">${escapeHtml(t("stats.roleTokens"))}</div>
              ${mission.roles
                .map(
                  (role) => `
                <div class="stats-bar-row">
                  <span class="stats-bar-label">${escapeHtml(role.label)}</span>
                  <div class="stats-bar-track"><div class="stats-bar-fill role" style="width:${barWidth(role.tokens.total, maxRoleTokens)}"></div></div>
                  <span class="stats-bar-value">${escapeHtml(formatTokens(role.tokens.total))} · ${escapeHtml(formatCost(role.cost))}</span>
                </div>`,
                )
                .join("")}
            </div>`
          : `<p class="empty-state">${escapeHtml(t("stats.noRoles"))}</p>`
        : `<span class="read-more">${escapeHtml(t("stats.expand"))}</span>`
    }
  </article>`
}

function barWidth(value: number, max: number) {
  return `${Math.max(4, Math.round((value / max) * 100))}%`
}

function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(Math.round(value))
}

function formatCost(value: number) {
  if (value >= 1) return `$${value.toFixed(2)}`
  if (value >= 0.01) return `$${value.toFixed(3)}`
  return `$${value.toFixed(4)}`
}

function formatDuration(ms: number) {
  if (ms <= 0) return "0m"
  const totalMinutes = Math.round(ms / 60_000)
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
}

function missionStatusClass(status: string) {
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
