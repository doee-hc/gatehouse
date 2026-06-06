import { childNodeIds } from "../tree/parse.ts"

export function collectSubtreeNodeIds(
  manifest: import("../tree/types.ts").TreeManifest,
  rootNodeId: string,
  includeRoot: boolean,
) {
  const ids: string[] = []
  const walk = (nodeId: string) => {
    const node = manifest.nodes[nodeId]
    if (!node) return
    ids.push(nodeId)
    for (const childId of childNodeIds(manifest, nodeId)) walk(childId)
  }
  if (includeRoot) walk(rootNodeId)
  else for (const childId of childNodeIds(manifest, rootNodeId)) walk(childId)
  return ids
}

export function collectSubtreeSessionIds(
  manifest: import("../tree/types.ts").TreeManifest,
  rootNodeId: string,
  includeRoot: boolean,
) {
  return collectSubtreeNodeIds(manifest, rootNodeId, includeRoot)
    .map((nodeId) => manifest.nodes[nodeId]?.session_id)
    .filter((id): id is string => Boolean(id))
}
