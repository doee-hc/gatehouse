export function collectSubtreeNodeIds(
  manifest: import("../tree/types.ts").TreeManifest,
  rootNodeId: string,
  includeRoot: boolean,
) {
  if (!manifest.nodes[rootNodeId]) return []
  return includeRoot ? [rootNodeId] : []
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
