import type { PortalOrchestrationFlowEdge } from "./orchestration-flow-edges.ts"

export type PlanNodeLayer = {
  depth: number
  rank: number
}

export function activationOrderFromPlan(
  nodeIds: string[],
  flowEdges: PortalOrchestrationFlowEdge[],
  stepNodeIds: Array<string | undefined>,
) {
  const order: string[] = []
  const seen = new Set<string>()

  for (const nodeId of stepNodeIds) {
    if (!nodeId || seen.has(nodeId)) continue
    seen.add(nodeId)
    order.push(nodeId)
  }

  for (const edge of flowEdges) {
    for (const nodeId of [edge.from, edge.to]) {
      if (!nodeIds.includes(nodeId) || seen.has(nodeId)) continue
      seen.add(nodeId)
      order.push(nodeId)
    }
  }

  for (const nodeId of nodeIds) {
    if (!seen.has(nodeId)) order.push(nodeId)
  }

  return order
}

/** Layer nodes left-to-right from plan flow edges (longest-path depth). */
export function computePlanNodeLayers(
  nodeIds: string[],
  flowEdges: PortalOrchestrationFlowEdge[],
  activationOrder: string[],
) {
  const depth = new Map<string, number>()
  for (const nodeId of nodeIds) depth.set(nodeId, 0)

  if (flowEdges.length > 0) {
    let changed = true
    let guard = 0
    while (changed && guard < nodeIds.length + 1) {
      changed = false
      guard += 1
      for (const edge of flowEdges) {
        if (!depth.has(edge.from) || !depth.has(edge.to)) continue
        const next = (depth.get(edge.from) ?? 0) + 1
        if (next > (depth.get(edge.to) ?? 0)) {
          depth.set(edge.to, next)
          changed = true
        }
      }
    }
  }

  const activationIndex = new Map(activationOrder.map((nodeId, index) => [nodeId, index]))
  const byDepth = new Map<number, string[]>()
  for (const nodeId of nodeIds) {
    const layerDepth = depth.get(nodeId) ?? 0
    const layer = byDepth.get(layerDepth) ?? []
    layer.push(nodeId)
    byDepth.set(layerDepth, layer)
  }

  const layers = new Map<string, PlanNodeLayer>()
  for (const [layerDepth, ids] of byDepth) {
    ids.sort(
      (left, right) =>
        (activationIndex.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (activationIndex.get(right) ?? Number.MAX_SAFE_INTEGER),
    )
    ids.forEach((nodeId, rank) => {
      layers.set(nodeId, { depth: layerDepth, rank })
    })
  }

  return layers
}

export function maxPlanLayoutDepth(layers: Map<string, PlanNodeLayer>) {
  let max = 0
  for (const layer of layers.values()) max = Math.max(max, layer.depth)
  return max
}

export function maxPlanLayoutWidth(layers: Map<string, PlanNodeLayer>) {
  const counts = new Map<number, number>()
  for (const layer of layers.values()) {
    counts.set(layer.depth, (counts.get(layer.depth) ?? 0) + 1)
  }
  let max = 0
  for (const count of counts.values()) max = Math.max(max, count)
  return max
}
