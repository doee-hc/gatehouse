import type { PortalSnapshot, PortalTreeNode } from "../api/types.ts"
import { refreshAgentOverlay } from "./agent-overlay.ts"
import { getBlogSnapshot } from "../portal/state.ts"
import { renderBlog } from "./blog.ts"
import { localeTag, t } from "./i18n.ts"
import { renderKnowledge } from "./knowledge.ts"
import { renderMissions } from "./office-sidebar.ts"

export function renderPortal(snapshot: PortalSnapshot) {
  renderStatus(snapshot)
  renderOffice(snapshot)
  renderKnowledge(snapshot)
  renderBlog(getBlogSnapshot())
  refreshAgentOverlay()
}

function renderStatus(snapshot: PortalSnapshot) {
  const statusLabel = document.getElementById("nav-status-label")
  if (statusLabel) {
    statusLabel.textContent = snapshot.project
      ? t("nav.project", { name: snapshot.project })
      : t("nav.connected")
  }

  const liveDot = document.getElementById("nav-live-dot")
  if (liveDot) {
    liveDot.className = isPortalLive(snapshot) ? "live-dot live" : "live-dot idle"
  }
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

  const escStatus = document.getElementById("esc-status")
  if (escStatus) {
    if (isPortalLive(snapshot)) {
      escStatus.textContent = t("esc.status.live")
      escStatus.className = "esc-status live"
    } else {
      escStatus.textContent = quiet ? t("esc.status.idle") : t("esc.status.connected")
      escStatus.className = quiet ? "esc-status idle" : "esc-status connected"
    }
  }

  const clock = document.getElementById("esc-time")
  if (clock) {
    clock.textContent = new Date().toLocaleTimeString(localeTag(), { hour: "2-digit", minute: "2-digit" })
  }

  renderMissions(snapshot)

  const miniTree = document.querySelector(".mini-tree")
  if (miniTree) {
    if (snapshot.tree) {
      miniTree.textContent = formatExecTreeLines(snapshot.tree, t("tree.coordinator"))
      return
    }
    miniTree.textContent = quiet
      ? t("empty.execTreeArchived")
      : snapshot.missions.length > 0
        ? t("empty.noExecTreeForMission")
        : t("empty.noExecTree")
  }

  const skillList = document.querySelector(".skill-list")
  if (skillList) {
    skillList.innerHTML =
      snapshot.skills.length > 0
        ? snapshot.skills
            .slice(0, 12)
            .map(
              (skill) =>
                `<li><span>${escapeHtml(skill.name)}</span><span class="skill-domain">${escapeHtml(skill.domain)}</span></li>`,
            )
            .join("")
        : `<li class="empty-state">${escapeHtml(t("empty.noSkills"))}</li>`
  }

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

function isPortalLive(snapshot: PortalSnapshot) {
  if (
    snapshot.missions.some((mission) => mission.status === "running" || mission.status === "retro")
  ) {
    return true
  }
  return snapshot.agents.some((agent) => agent.status === "busy" || agent.status === "research")
}

function isQuietOffice(snapshot: PortalSnapshot) {
  if (snapshot.missions.length === 0) return false
  const noActive = !snapshot.missions.some(
    (mission) => mission.status === "running" || mission.status === "retro",
  )
  const noBusy = !snapshot.agents.some((agent) => agent.status === "busy" || agent.status === "research")
  return noActive && noBusy
}

function formatExecTreeLines(
  tree: NonNullable<PortalSnapshot["tree"]>,
  coordinatorLabel: string,
) {
  const nodeIds = new Set(tree.nodes.map((node) => node.node_id))
  const childrenByParent = new Map<string, PortalTreeNode[]>()

  for (const node of tree.nodes) {
    if (node.node_id === tree.root_node) continue
    const parentId =
      node.parent && node.parent !== node.node_id && nodeIds.has(node.parent)
        ? node.parent
        : tree.root_node
    const siblings = childrenByParent.get(parentId) ?? []
    siblings.push(node)
    childrenByParent.set(parentId, siblings)
  }

  for (const children of childrenByParent.values()) {
    children.sort((a, b) => a.node_id.localeCompare(b.node_id))
  }

  const lines = [`${tree.root_node} ${coordinatorLabel}`]

  const appendChildren = (parentId: string, prefix: string) => {
    const children = childrenByParent.get(parentId)
    if (!children?.length) return

    children.forEach((node, index) => {
      const isLast = index === children.length - 1
      const branch = isLast ? "└── " : "├── "
      const domain = node.skill_domain ? ` · ${node.skill_domain}` : ""
      const label = node.display_name || node.node_id
      lines.push(`${prefix}${branch}${label}${domain}`)
      appendChildren(node.node_id, `${prefix}${isLast ? "    " : "│   "}`)
    })
  }

  appendChildren(tree.root_node, "")
  return lines.join("\n")
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
