export type AgentSelectionDetail = {
  spawnId: string
  name: string
  status: string
  nodeId?: string
  profile: string
  scope: string
  description?: string
  skills?: string[]
  /** Desktop overlay: show on the opposite side of the map click. */
  panelSide?: "left" | "right"
}

const mapListeners = new Set<(detail: AgentSelectionDetail) => void>()
const clearListeners = new Set<() => void>()

export function onAgentSelectedFromMap(listener: (detail: AgentSelectionDetail) => void) {
  mapListeners.add(listener)
  return () => mapListeners.delete(listener)
}

export function emitAgentSelectedFromMap(detail: AgentSelectionDetail) {
  for (const listener of mapListeners) listener(detail)
}

export function onAgentSelectionCleared(listener: () => void) {
  clearListeners.add(listener)
  return () => clearListeners.delete(listener)
}

export function emitAgentSelectionCleared() {
  for (const listener of clearListeners) listener()
}

export function truncateLabel(value: string, max = 12) {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}
