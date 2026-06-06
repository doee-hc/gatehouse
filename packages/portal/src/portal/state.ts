import type { BlogSnapshot, PortalSnapshot } from "../api/types.ts"

let snapshot: PortalSnapshot | undefined
let blog: BlogSnapshot | undefined
let sessionToSpawn = new Map<string, string>()

function rebuildSessionIndex(next: PortalSnapshot) {
  sessionToSpawn = new Map(
    next.agents.map((agent) => [agent.session_id, agent.spawn_id] as const),
  )
  for (const tree of next.trees ?? (next.tree ? [next.tree] : [])) {
    for (const node of tree.nodes) {
      sessionToSpawn.set(node.session_id, node.node_id.replace(/[^a-zA-Z0-9_-]/g, "-"))
    }
  }
}

export function setPortalSnapshot(next: PortalSnapshot) {
  snapshot = next
  rebuildSessionIndex(next)
}

export function getPortalSnapshot() {
  return snapshot
}

export function setBlogSnapshot(next: BlogSnapshot) {
  blog = next
}

export function getBlogSnapshot() {
  return blog
}

export function spawnForSession(sessionId: string) {
  return sessionToSpawn.get(sessionId)
}
