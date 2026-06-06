import Phaser from "phaser"
import { truncateLabel } from "../bridge/map-sidebar.ts"
import { agentStatusLabel, t, type MessageKey } from "../shell/i18n.ts"

export type AgentStatus = "idle" | "busy" | "research" | "blocked"

export type ZoneDef = {
  id: string
  messageKey: MessageKey
  worldX: number
  worldY: number
}

/** Screen-space anchor points derived from Agent container world matrix. */
export type AgentLabelRecord = {
  id: string
  name: string
  status: AgentStatus
  selected: boolean
  nameX: number
  nameY: number
  bubbleX: number
  bubbleY: number
}

const STATUS_CLASS: Record<AgentStatus, string> = {
  idle: "status-idle",
  busy: "status-busy",
  research: "status-research",
  blocked: "status-blocked",
}

const BUBBLE_MAX_CHARS = 28
export const CHAT_BUBBLE_MS = 3000

/** Sprite local offsets from container origin (origin 0.5, 0.85). */
export const AGENT_LABEL_LOCAL = {
  name: { x: 0, y: -35.4 },
  bubble: { x: 0, y: -35.4 },
} as const

export class OfficeDomLabels {
  stack: HTMLElement
  layer: HTMLElement
  zoneLayer: HTMLElement
  game?: Phaser.Game
  getCamera?: () => Phaser.Cameras.Scene2D.Camera | undefined
  agents = new Map<string, { el: HTMLElement; record: AgentLabelRecord }>()
  zones = new Map<string, HTMLElement>()
  bubbleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  bubbleDismiss = new Map<string, () => void>()
  bubbleFull = new Map<string, string>()
  zoneDefs: ZoneDef[] = []

  constructor(stack: HTMLElement) {
    this.stack = stack
    this.layer = document.createElement("div")
    this.layer.id = "office-labels"
    this.layer.className = "office-labels"
    this.zoneLayer = document.createElement("div")
    this.zoneLayer.className = "office-labels-zones"
    this.layer.appendChild(this.zoneLayer)
    stack.appendChild(this.layer)
  }

  attach(game: Phaser.Game, getCamera: () => Phaser.Cameras.Scene2D.Camera | undefined) {
    this.game = game
    this.getCamera = getCamera
    this.syncLayout()
  }

  setVisible(visible: boolean) {
    this.layer.style.visibility = visible ? "visible" : "hidden"
  }

  syncLayout() {
    if (!this.game) return
    const canvas = this.game.canvas
    const stackRect = this.stack.getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()
    this.layer.style.left = `${canvasRect.left - stackRect.left}px`
    this.layer.style.top = `${canvasRect.top - stackRect.top}px`
    this.layer.style.width = `${canvasRect.width}px`
    this.layer.style.height = `${canvasRect.height}px`
  }

  worldToLayer(worldX: number, worldY: number) {
    const game = this.game
    const camera = this.getCamera?.()
    if (!game || !camera) return { x: 0, y: 0 }

    const view = camera.worldView
    const gameX = (worldX - view.x) * camera.zoom
    const gameY = (worldY - view.y) * camera.zoom
    const scale = game.scale
    return {
      x: gameX / scale.displayScale.x,
      y: gameY / scale.displayScale.y,
    }
  }

  placeLabel(el: HTMLElement, worldX: number, worldY: number, transform: string) {
    const pos = this.worldToLayer(worldX, worldY)
    el.style.left = `${pos.x.toFixed(2)}px`
    el.style.top = `${pos.y.toFixed(2)}px`
    el.style.transform = transform
  }

  setZones(zones: ZoneDef[]) {
    this.zoneDefs = zones
    this.zoneLayer.replaceChildren()
    this.zones.clear()
    for (const zone of zones) {
      const el = document.createElement("div")
      el.className = "office-zone-label"
      el.dataset.zoneId = zone.id
      el.textContent = t(zone.messageKey)
      this.zoneLayer.appendChild(el)
      this.zones.set(zone.id, el)
    }
    this.repositionZones()
  }

  refreshZoneLocale() {
    for (const zone of this.zoneDefs) {
      this.zones.get(zone.id)!.textContent = t(zone.messageKey)
    }
  }

  syncAgents(records: AgentLabelRecord[]) {
    const ids = new Set(records.map((record) => record.id))
    for (const id of this.agents.keys()) {
      if (ids.has(id)) continue
      this.removeAgent(id)
    }
    for (const record of records) {
      const entry = this.agents.get(record.id)
      if (!entry) {
        this.upsertAgent(record)
        continue
      }
      entry.record = record
      this.applyAgentRecord(entry)
      this.positionAgent(entry)
    }
  }

  repositionAgents(records: AgentLabelRecord[]) {
    for (const record of records) {
      const entry = this.agents.get(record.id)
      if (!entry) continue
      entry.record = record
      this.positionAgent(entry)
    }
  }

  upsertAgent(record: AgentLabelRecord) {
    let entry = this.agents.get(record.id)
    if (!entry) {
      const el = this.createAgentElement(record.id)
      this.layer.appendChild(el)
      entry = { el, record }
      this.agents.set(record.id, entry)
    }
    entry.record = record
    this.applyAgentRecord(entry)
    this.positionAgent(entry)
  }

  removeAgent(id: string) {
    const entry = this.agents.get(id)
    if (!entry) return
    entry.el.remove()
    this.agents.delete(id)
    this.bubbleFull.delete(id)
    const timer = this.bubbleTimers.get(id)
    if (timer) clearTimeout(timer)
    this.bubbleTimers.delete(id)
    this.bubbleDismiss.delete(id)
  }

  createAgentElement(id: string) {
    const el = document.createElement("div")
    el.className = "office-agent-label"
    el.dataset.agentId = id

    const bubble = document.createElement("div")
    bubble.className = "office-agent-bubble"
    bubble.hidden = true

    const name = document.createElement("div")
    name.className = "office-agent-name"

    const dot = document.createElement("span")
    dot.className = "office-agent-status-dot"

    const nameText = document.createElement("span")
    nameText.className = "office-agent-name-text"

    name.append(dot, nameText)
    el.append(bubble, name)

    bubble.addEventListener("pointerenter", () => {
      const full = this.bubbleFull.get(id)
      if (full) bubble.textContent = full
    })
    bubble.addEventListener("pointerleave", () => {
      const full = this.bubbleFull.get(id)
      if (full) bubble.textContent = truncateLabel(full, BUBBLE_MAX_CHARS)
    })

    return el
  }

  applyAgentRecord({ el, record }: { el: HTMLElement; record: AgentLabelRecord }) {
    const nameEl = el.querySelector(".office-agent-name") as HTMLElement
    const dotEl = el.querySelector(".office-agent-status-dot") as HTMLElement
    const nameTextEl = el.querySelector(".office-agent-name-text") as HTMLElement
    nameTextEl.textContent = truncateLabel(record.name, 10)
    nameEl.classList.toggle("selected", record.selected)
    nameEl.title = `${agentStatusLabel(record.status)} · ${record.name}`
    dotEl.className = `office-agent-status-dot ${STATUS_CLASS[record.status]}`
  }

  positionAgent({ el, record }: { el: HTMLElement; record: AgentLabelRecord }) {
    const nameEl = el.querySelector(".office-agent-name") as HTMLElement
    const bubbleEl = el.querySelector(".office-agent-bubble") as HTMLElement

    this.placeLabel(nameEl, record.nameX, record.nameY, "translate(-50%, -100%)")
    if (!bubbleEl.hidden) {
      this.placeLabel(bubbleEl, record.bubbleX, record.bubbleY, "translate(-50%, -100%)")
    }
  }

  repositionAll() {
    for (const entry of this.agents.values()) this.positionAgent(entry)
    this.repositionZones()
  }

  repositionZones() {
    for (const zone of this.zoneDefs) {
      const el = this.zones.get(zone.id)
      if (!el) continue
      this.placeLabel(el, zone.worldX, zone.worldY, "none")
    }
  }

  showBubble(id: string, text: string, ms = 0, onDismiss?: () => void) {
    const entry = this.agents.get(id)
    if (!entry) return
    const bubble = entry.el.querySelector(".office-agent-bubble") as HTMLElement
    const timer = this.bubbleTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.bubbleTimers.delete(id)
    }

    if (!text) {
      this.bubbleFull.delete(id)
      bubble.hidden = true
      bubble.textContent = ""
      const dismiss = this.bubbleDismiss.get(id)
      this.bubbleDismiss.delete(id)
      dismiss?.()
      onDismiss?.()
      return
    }

    if (onDismiss) this.bubbleDismiss.set(id, onDismiss)

    this.bubbleFull.set(id, text)
    bubble.textContent = truncateLabel(text, BUBBLE_MAX_CHARS)
    bubble.hidden = false
    this.positionAgent(entry)

    if (ms <= 0) return
    this.bubbleTimers.set(
      id,
      setTimeout(() => {
        this.showBubble(id, "")
      }, ms),
    )
  }

  clearBubble(id: string) {
    const timer = this.bubbleTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.bubbleTimers.delete(id)
    }
    this.bubbleDismiss.delete(id)
    const entry = this.agents.get(id)
    if (!entry) return
    const bubble = entry.el.querySelector(".office-agent-bubble") as HTMLElement
    this.bubbleFull.delete(id)
    bubble.hidden = true
    bubble.textContent = ""
  }

  showChatBubble(id: string, text: string, onDismiss?: () => void) {
    this.clearBubble(id)
    this.showBubble(id, text, CHAT_BUBBLE_MS, onDismiss)
  }
}

let instance: OfficeDomLabels | undefined

export function initOfficeDomLabels(stack: HTMLElement) {
  if (instance) return instance
  instance = new OfficeDomLabels(stack)
  return instance
}

export function getOfficeDomLabels() {
  return instance
}

export function agentLabelAnchorsFromMatrix(matrix: Phaser.GameObjects.Components.TransformMatrix) {
  const local = AGENT_LABEL_LOCAL
  const name = new Phaser.Math.Vector2()
  const bubble = new Phaser.Math.Vector2()
  matrix.transformPoint(local.name.x, local.name.y, name)
  matrix.transformPoint(local.bubble.x, local.bubble.y, bubble)
  return {
    nameX: name.x,
    nameY: name.y,
    bubbleX: bubble.x,
    bubbleY: bubble.y,
  }
}
