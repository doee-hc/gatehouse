import type { BlogSnapshot, PortalSnapshot } from "../api/types.ts"

let snapshot: PortalSnapshot | undefined
let blog: BlogSnapshot | undefined

export function setPortalSnapshot(next: PortalSnapshot) {
  snapshot = next
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
