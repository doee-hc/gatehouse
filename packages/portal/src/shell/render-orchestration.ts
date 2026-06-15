import type {
  PortalOrchestration,
  PortalOrchestrationNode,
  PortalOrchestrationStep,
  PortalSnapshot,
} from "../api/types.ts"
import { truncateLabel } from "../bridge/map-sidebar.ts"
import { localeTag, t, type MessageKey } from "./i18n.ts"

const SANDBOX_STATUS_KEYS: Record<string, MessageKey> = {
  running: "orch.sandbox.running",
  stopped: "orch.sandbox.stopped",
  completed: "orch.sandbox.completed",
  failed: "orch.sandbox.failed",
}

export function renderOrchestrationPanel(snapshot: PortalSnapshot) {
  const host = document.getElementById("orchestration-host")
  if (!host) return

  const orch = snapshot.orchestration
  if (!orch) {
    host.innerHTML = `<p class="empty-state orch-empty">${escapeHtml(resolveOrchestrationEmpty(snapshot))}</p>`
    return
  }

  host.innerHTML = [
    renderPhaseStrip(orch),
    renderNodeTree(orch),
    renderStepTimeline(orch),
    renderOrchestrationFooter(orch),
  ].join("")
}

function resolveOrchestrationEmpty(snapshot: PortalSnapshot) {
  if (snapshot.lingering_mission_id && !snapshot.active_mission_id) {
    return t("empty.orchestrationArchived")
  }
  if (snapshot.missions.some((mission) => mission.status === "running" || mission.status === "retro")) {
    return t("empty.orchestrationPending")
  }
  return t("empty.orchestrationIdle")
}

function renderPhaseStrip(orch: PortalOrchestration) {
  if (orch.phases.length === 0) {
    if (!orch.phase) return ""
    return `<div class="orch-phase-strip orch-phase-strip-single">
      <span class="orch-phase-current">${escapeHtml(orch.phase)}</span>
    </div>`
  }

  const items = orch.phases
    .map((phase) => {
      const cls = `orch-phase-item orch-phase-${phase.state}`
      return `<div class="${cls}" title="${escapeHtml(phase.title)}">
        <span class="orch-phase-dot" aria-hidden="true"></span>
        <span class="orch-phase-label">${escapeHtml(truncateLabel(phase.title, 10))}</span>
      </div>`
    })
    .join("")

  return `<div class="orch-phase-strip" role="list">${items}</div>`
}

function renderNodeTree(orch: PortalOrchestration) {
  const byId = new Map(orch.nodes.map((node) => [node.node_id, node]))
  const childrenByParent = new Map<string, PortalOrchestrationNode[]>()

  for (const node of orch.nodes) {
    if (node.node_id === orch.root_node) continue
    const parentId =
      node.parent && node.parent !== node.node_id && byId.has(node.parent)
        ? node.parent
        : orch.root_node
    const siblings = childrenByParent.get(parentId) ?? []
    siblings.push(node)
    childrenByParent.set(parentId, siblings)
  }

  for (const children of childrenByParent.values()) {
    children.sort((a, b) => a.node_id.localeCompare(b.node_id))
  }

  const root = byId.get(orch.root_node)
  const rows: string[] = []
  if (root) rows.push(renderNodeRow(root, 0, true))

  const walk = (parentId: string, depth: number) => {
    const children = childrenByParent.get(parentId)
    if (!children?.length) return
    for (const child of children) {
      rows.push(renderNodeRow(child, depth, false))
      walk(child.node_id, depth + 1)
    }
  }

  walk(orch.root_node, 1)

  return `<div class="orch-tree" role="tree">${rows.join("")}</div>`
}

function renderNodeRow(node: PortalOrchestrationNode, depth: number, isRoot: boolean) {
  const statusLabel = t(`orch.nodeStatus.${node.status}`)
  const domain = node.skill_domain
    ? `<span class="orch-node-domain">${escapeHtml(truncateLabel(node.skill_domain, 8))}</span>`
    : ""
  const round =
    node.round && node.round > 1
      ? `<span class="orch-node-round">R${node.round}</span>`
      : ""

  return `<div class="orch-node orch-status-${node.status}${isRoot ? " orch-node-root" : ""}" role="treeitem" style="--orch-depth:${depth}" title="${escapeHtml(node.node_id)} · ${escapeHtml(statusLabel)}">
    <span class="orch-node-badge" aria-hidden="true">${nodeStatusIcon(node.status)}</span>
    <span class="orch-node-label">${escapeHtml(truncateLabel(node.display_name, isRoot ? 16 : 14))}</span>
    ${domain}
    ${round}
  </div>`
}

function nodeStatusIcon(status: PortalOrchestrationNode["status"]) {
  if (status === "done") return "✓"
  if (status === "running") return "●"
  if (status === "blocked" || status === "rework") return "!"
  return "○"
}

function renderStepTimeline(orch: PortalOrchestration) {
  if (orch.steps.length === 0) return ""

  const visible = orch.steps.length > 12 ? orch.steps.slice(0, 12) : orch.steps
  const items = visible
    .map((step) => `<li class="orch-step orch-step-${step.state}" title="${escapeHtml(stepDetail(step))}">${escapeHtml(stepIcon(step))}</li>`)
    .join("")

  const overflow =
    orch.steps.length > visible.length
      ? `<li class="orch-step orch-step-more">+${orch.steps.length - visible.length}</li>`
      : ""

  return `<ol class="orch-step-timeline" aria-label="${escapeHtml(t("orch.stepTimeline"))}">${items}${overflow}</ol>`
}

function stepIcon(step: PortalOrchestrationStep) {
  switch (step.op) {
    case "phase":
      return "◆"
    case "setBrief":
      return "B"
    case "prompt":
      return "→"
    case "wait":
      return "⏳"
    case "waitRollup":
      return "↥"
    case "parallel":
      return "∥"
    case "pipeline":
      return "⇢"
    case "log":
      return "…"
    default:
      return "·"
  }
}

function stepDetail(step: PortalOrchestrationStep) {
  const op = t(`orch.stepOp.${step.op}`)
  const target = step.title ?? step.node_id
  return target ? `${op} · ${target}` : op
}

function renderOrchestrationFooter(orch: PortalOrchestration) {
  const current = orch.steps.find((step) => step.state === "current")
  const parts: string[] = []

  if (orch.total_steps > 0) {
    parts.push(t("orch.progress", { done: String(orch.completed_steps), total: String(orch.total_steps) }))
  }

  if (current) {
    parts.push(t(`orch.stepOp.${current.op}`))
  } else if (orch.sandbox_status) {
    const key = SANDBOX_STATUS_KEYS[orch.sandbox_status]
    if (key) parts.push(t(key))
  }

  if (parts.length === 0) return ""
  return `<div class="orch-footer">${escapeHtml(parts.join(" · "))}</div>`
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

export function formatOrchestrationUpdatedAt(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleTimeString(localeTag(), { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}
