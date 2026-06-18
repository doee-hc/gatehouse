import type { PortalOrchestration, PortalSnapshot } from "../api/types.ts"
import { applyOrchestrationGraphLabelScale, renderOrchestrationGraph } from "./orchestration-graph.ts"
import { localeTag, t, type MessageKey } from "./i18n.ts"

const SANDBOX_STATUS_KEYS: Record<string, MessageKey> = {
  running: "orch.sandbox.running",
  stopped: "orch.sandbox.stopped",
  completed: "orch.sandbox.completed",
  failed: "orch.sandbox.failed",
}

let overlayKeyHandler: ((event: KeyboardEvent) => void) | undefined
let overlayGraphResizeObserver: ResizeObserver | undefined
let miniGraphResizeObserver: ResizeObserver | undefined

function syncOrchestrationGraphLabels(root: Element) {
  requestAnimationFrame(() => applyOrchestrationGraphLabelScale(root))
}

function bindMiniGraphLabelScale(root: Element) {
  syncOrchestrationGraphLabels(root)
  if (typeof ResizeObserver === "undefined") return

  if (!miniGraphResizeObserver) {
    miniGraphResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        applyOrchestrationGraphLabelScale(entry.target)
      }
    })
  }

  miniGraphResizeObserver.disconnect()
  miniGraphResizeObserver.observe(root)
}

function mountExpandedOrchestrationGraph(body: Element, orch: PortalOrchestration) {
  body.innerHTML = renderOrchestrationGraph(orch, "expanded", "orch-expanded")
  bindExpandedGraphResize(body)
  syncOrchestrationGraphLabels(body)
}

function scheduleExpandedGraphFit(body: Element) {
  requestAnimationFrame(() => fitExpandedOrchestrationGraph(body))
}

function overlayBodyContentSize(bodyEl: HTMLElement) {
  const style = getComputedStyle(bodyEl)
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
  return {
    width: Math.max(0, bodyEl.clientWidth - padX),
    height: Math.max(0, bodyEl.clientHeight - padY),
  }
}

function fitExpandedOrchestrationGraph(body: Element) {
  const wrap = body.querySelector(".orch-graph-wrap-expanded") as HTMLElement | null
  const svg = body.querySelector(".orch-graph-svg-expanded") as SVGSVGElement | null
  if (!wrap || !svg || !(body instanceof HTMLElement)) return

  const contentSize = overlayBodyContentSize(body)
  const width = contentSize.width
  const height = contentSize.height
  if (width <= 0 || height <= 0) return

  const viewBox = svg.viewBox.baseVal
  if (viewBox.width <= 0 || viewBox.height <= 0) return

  const graphAspect = viewBox.width / viewBox.height
  const containerAspect = width / height
  let renderWidth = width
  let renderHeight = height

  if (graphAspect > containerAspect) {
    renderHeight = width / graphAspect
  } else {
    renderWidth = height * graphAspect
  }

  svg.style.width = `${renderWidth}px`
  svg.style.height = `${renderHeight}px`
  wrap.style.width = `${width}px`
  wrap.style.height = `${height}px`
  applyOrchestrationGraphLabelScale(body)
}

function bindExpandedGraphResize(body: Element) {
  if (typeof ResizeObserver === "undefined") {
    scheduleExpandedGraphFit(body)
    return
  }

  if (!overlayGraphResizeObserver) {
    overlayGraphResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        fitExpandedOrchestrationGraph(entry.target)
      }
    })
  }

  overlayGraphResizeObserver.disconnect()
  overlayGraphResizeObserver.observe(body)
  scheduleExpandedGraphFit(body)
}

export function renderOrchestrationPanel(snapshot: PortalSnapshot) {
  const host = document.getElementById("orchestration-host")
  if (!host) return

  const orch = snapshot.orchestration
  if (!orch) {
    closeOrchestrationOverlay()
    host.innerHTML = `<p class="empty-state orch-empty">${escapeHtml(resolveOrchestrationEmpty(snapshot))}</p>`
    return
  }

  host.innerHTML = [
    renderMiniSummary(orch),
    renderMiniPreview(orch),
    renderExpandHint(),
  ].join("")

  bindOrchestrationPanel(orch)
  const miniPreview = host.querySelector("#orch-mini-preview-btn")
  if (miniPreview) bindMiniGraphLabelScale(miniPreview)
  refreshOrchestrationOverlayIfOpen(orch)
}

function renderMiniSummary(orch: PortalOrchestration) {
  const current = orch.steps.find((step) => step.state === "current")
  const statusLine = resolveStatusLine(orch, current)
  const progressPct =
    orch.total_steps > 0 ? Math.round((orch.completed_steps / orch.total_steps) * 100) : 0

  const counts = countNodeStatuses(orch)

  return `<div class="orch-mini-summary">
    <div class="orch-mini-head">
      <span class="orch-mini-progress-text">${escapeHtml(
        orch.total_steps > 0
          ? t("orch.progress", { done: String(orch.completed_steps), total: String(orch.total_steps) })
          : t("orch.noSteps"),
      )}</span>
      <button type="button" class="orch-expand-btn" id="orch-expand-btn" title="${escapeAttr(t("orch.expand"))}">
        ${escapeHtml(t("orch.expand"))}
      </button>
    </div>
    <div class="orch-progress-bar" role="progressbar" aria-valuenow="${progressPct}" aria-valuemin="0" aria-valuemax="100">
      <div class="orch-progress-fill" style="width:${progressPct}%"></div>
    </div>
    ${statusLine ? `<p class="orch-mini-status">${escapeHtml(statusLine)}</p>` : ""}
    <div class="orch-mini-counts" aria-label="${escapeAttr(t("orch.nodeCounts"))}">
      <span class="orch-count orch-count-done">${counts.done} ${escapeHtml(t("orch.countDone"))}</span>
      <span class="orch-count orch-count-running">${counts.running} ${escapeHtml(t("orch.countRunning"))}</span>
      <span class="orch-count orch-count-pending">${counts.pending} ${escapeHtml(t("orch.countPending"))}</span>
    </div>
  </div>`
}

function renderMiniPreview(orch: PortalOrchestration) {
  return `<div class="orch-mini-preview" id="orch-mini-preview-btn" role="button" tabindex="0" aria-label="${escapeAttr(t("orch.expand"))}">
    ${renderOrchestrationGraph(orch, "mini", "orch-mini")}
  </div>`
}

function renderExpandHint() {
  return `<p class="orch-mini-hint">${escapeHtml(t("orch.expandHint"))}</p>`
}

function resolveStatusLine(
  orch: PortalOrchestration,
  current: PortalOrchestration["steps"][number] | undefined,
) {
  if (current) {
    const op = t(`orch.stepOp.${current.op}`)
    return current.node_id ? `${op} · ${current.node_id}` : op
  }
  if (orch.sandbox_status) {
    const key = SANDBOX_STATUS_KEYS[orch.sandbox_status]
    if (key) return t(key)
  }
  return ""
}

function countNodeStatuses(orch: PortalOrchestration) {
  let done = 0
  let running = 0
  let pending = 0
  for (const node of orch.nodes) {
    if (node.status === "done") done += 1
    else if (node.status === "running") running += 1
    else pending += 1
  }
  return { done, running, pending }
}

function bindOrchestrationPanel(orch: PortalOrchestration) {
  const open = () => openOrchestrationOverlay(orch)
  const expandBtn = document.getElementById("orch-expand-btn")
  const previewBtn = document.getElementById("orch-mini-preview-btn")
  if (expandBtn) expandBtn.onclick = open
  if (previewBtn) {
    previewBtn.onclick = open
    previewBtn.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        open()
      }
    }
  }
}

function refreshOrchestrationOverlayIfOpen(orch: PortalOrchestration) {
  const overlay = document.getElementById("orchestration-overlay")
  if (!overlay || overlay.hidden) return
  const body = overlay.querySelector(".orch-overlay-body")
  if (!body) return
  mountExpandedOrchestrationGraph(body, orch)
  const subtitle = overlay.querySelector(".orch-overlay-subtitle")
  if (subtitle) subtitle.textContent = resolveOverlaySubtitle(orch)
}

export function openOrchestrationOverlay(orch: PortalOrchestration) {
  let overlay = document.getElementById("orchestration-overlay")
  if (!overlay) {
    overlay = document.createElement("div")
    overlay.id = "orchestration-overlay"
    overlay.className = "orch-overlay"
    overlay.hidden = true
    overlay.innerHTML = `<div class="orch-overlay-backdrop" data-orch-close></div>
      <div class="orch-overlay-panel" role="dialog" aria-modal="true" aria-labelledby="orch-overlay-title">
        <header class="orch-overlay-header">
          <div>
            <h2 id="orch-overlay-title">${escapeHtml(t("orch.graphLabel"))}</h2>
            <p class="orch-overlay-subtitle"></p>
          </div>
          <button type="button" class="orch-overlay-close" data-orch-close aria-label="${escapeAttr(t("orch.close"))}">×</button>
        </header>
        <div class="orch-overlay-body"></div>
      </div>`
    document.body.appendChild(overlay)
    overlay.querySelectorAll("[data-orch-close]").forEach((el) => {
      el.addEventListener("click", () => closeOrchestrationOverlay())
    })
  }

  const subtitle = overlay.querySelector(".orch-overlay-subtitle")
  if (subtitle) subtitle.textContent = resolveOverlaySubtitle(orch)

  overlay.hidden = false
  document.body.classList.add("orch-overlay-open")

  const body = overlay.querySelector(".orch-overlay-body")
  if (body) mountExpandedOrchestrationGraph(body, orch)

  if (!overlayKeyHandler) {
    overlayKeyHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeOrchestrationOverlay()
    }
    document.addEventListener("keydown", overlayKeyHandler)
  }
}

function resolveOverlaySubtitle(orch: PortalOrchestration) {
  const parts: string[] = []
  if (orch.total_steps > 0) {
    parts.push(t("orch.progress", { done: String(orch.completed_steps), total: String(orch.total_steps) }))
  }
  const current = orch.steps.find((step) => step.state === "current")
  if (current) {
    const op = t(`orch.stepOp.${current.op}`)
    parts.push(current.node_id ? `${op} · ${current.node_id}` : op)
  } else if (orch.sandbox_status === "completed") {
    parts.push(t("orch.sandbox.completed"))
  }
  return parts.join(" · ")
}

export function closeOrchestrationOverlay() {
  const overlay = document.getElementById("orchestration-overlay")
  if (!overlay) return
  overlay.hidden = true
  document.body.classList.remove("orch-overlay-open")
  overlayGraphResizeObserver?.disconnect()
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

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function escapeAttr(value: string) {
  return escapeHtml(value)
}

export function formatOrchestrationUpdatedAt(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleTimeString(localeTag(), { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}
