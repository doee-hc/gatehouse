import type {
  PortalOrchestration,
  PortalOrchestrationFlowEdge,
  PortalOrchestrationNode,
} from "../api/types.ts"
import {
  computePlanNodeLayers,
  maxPlanLayoutDepth,
  maxPlanLayoutWidth,
} from "../../../core/src/portal/orchestration-plan-layout.ts"
import { t } from "./i18n.ts"

export type OrchestrationGraphVariant = "mini" | "expanded"

type Point = { x: number; y: number }

type Rect = { minX: number; minY: number; maxX: number; maxY: number }

type NodeObstacle = { nodeId: string; rect: Rect }

const ROUTE_PAD = 3

/** Fallback when `--orch-graph-label-size` is unavailable (e.g. unit tests). */
const ORCH_GRAPH_LABEL_SCREEN_PX_FALLBACK = 10

function cssLengthToScreenPx(context: Element, length: string) {
  const probe = document.createElement("span")
  probe.style.position = "absolute"
  probe.style.visibility = "hidden"
  probe.style.pointerEvents = "none"
  probe.style.fontSize = length
  context.appendChild(probe)
  const px = Number.parseFloat(getComputedStyle(probe).fontSize)
  context.removeChild(probe)
  return Number.isFinite(px) && px > 0 ? px : undefined
}

/** Resolve label screen px from `--orch-graph-label-size` on `.orch-graph-wrap`. */
export function resolveOrchestrationGraphLabelScreenPx(root: Element) {
  const wrap = root.querySelector(".orch-graph-wrap") ?? root
  const custom = getComputedStyle(wrap).getPropertyValue("--orch-graph-label-size").trim()
  if (custom) {
    const px = cssLengthToScreenPx(wrap, custom)
    if (px) return px
  }
  return ORCH_GRAPH_LABEL_SCREEN_PX_FALLBACK
}

type LabelPlacement = "above"

type LayoutPos = {
  x: number
  y: number
  depth: number
  labelPlacement: LabelPlacement
  width: number
  height: number
}

type GraphMetrics = {
  dotRadius: number
  nodeWidth: number
  nodeHeight: number
  levelGap: number
  siblingGap: number
  padding: number
  arrowOffset: number
  flowCurveOffset: number
  labelMax: number
  fontSize: number
  iconSize: number
  labelGap: number
}

const MINI_METRICS_BASE: GraphMetrics = {
  dotRadius: 5,
  nodeWidth: 10,
  nodeHeight: 10,
  levelGap: 42,
  siblingGap: 4,
  padding: 12,
  arrowOffset: 5,
  flowCurveOffset: 8,
  labelMax: 64,
  fontSize: 10,
  iconSize: 8,
  labelGap: 3,
}

function miniMetricsForPlan(nodeCount: number, maxDepth: number, maxWidth: number): GraphMetrics {
  const base = MINI_METRICS_BASE
  const verticalDensity = Math.max(nodeCount / 10, maxWidth / 6, 1)
  const verticalCompact = Math.min(1, 1 / Math.sqrt(verticalDensity))
  const depthBoost = Math.max(0, 3 - maxDepth) * 6
  return {
    ...base,
    levelGap: Math.min(58, base.levelGap + depthBoost),
    siblingGap: Math.max(1, Math.round(base.siblingGap * verticalCompact)),
    fontSize: Math.max(9, Math.round(base.fontSize * Math.sqrt(verticalCompact))),
    labelMax: base.labelMax,
    dotRadius: Math.max(4, Math.round(base.dotRadius * Math.sqrt(verticalCompact))),
    padding: Math.max(10, Math.round(base.padding * verticalCompact)),
  }
}

function metricsForVariant(
  _variant: OrchestrationGraphVariant,
  nodeCount: number,
  maxDepth: number,
  maxWidth: number,
): GraphMetrics {
  return miniMetricsForPlan(nodeCount, maxDepth, maxWidth)
}

function layoutPlanFlow(orch: PortalOrchestration, metrics: GraphMetrics) {
  const nodeIds = orch.nodes.map((node) => node.node_id)
  const layers = computePlanNodeLayers(nodeIds, orch.flow_edges, orch.activation_order)
  const positions = new Map<string, LayoutPos>()
  const blockHeight = nodeBlockHeight(metrics)

  const byDepth = new Map<number, string[]>()
  for (const nodeId of nodeIds) {
    const layer = layers.get(nodeId) ?? { depth: 0, rank: 0 }
    const depthNodes = byDepth.get(layer.depth) ?? []
    depthNodes.push(nodeId)
    byDepth.set(layer.depth, depthNodes)
  }

  for (const [depth, ids] of byDepth) {
    ids.sort(
      (left, right) =>
        (layers.get(left)?.rank ?? 0) - (layers.get(right)?.rank ?? 0),
    )
    let top = metrics.padding
    const x = metrics.padding + depth * metrics.levelGap + metrics.dotRadius

    for (const nodeId of ids) {
      const y = top + blockHeight / 2
      positions.set(nodeId, {
        x,
        y,
        depth,
        labelPlacement: "above",
        width: metrics.dotRadius * 2,
        height: blockHeight,
      })
      top += blockHeight + metrics.siblingGap
    }
  }

  return { positions, layers }
}

function stretchMiniLayoutHorizontally(positions: Map<string, LayoutPos>, metrics: GraphMetrics) {
  if (positions.size === 0) return

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const pos of positions.values()) {
    minX = Math.min(minX, pos.x)
    maxX = Math.max(maxX, pos.x)
    minY = Math.min(minY, pos.y)
    maxY = Math.max(maxY, pos.y)
  }

  const contentW = Math.max(maxX - minX, 1)
  const contentH = Math.max(maxY - minY, 1)
  const targetWidth = contentH * 1.55
  if (contentW >= targetWidth) return

  const scale = targetWidth / contentW
  for (const pos of positions.values()) {
    pos.x = metrics.padding + (pos.x - minX) * scale
  }
}

function nodeBlockHeight(metrics: GraphMetrics) {
  return metrics.fontSize + metrics.labelGap + metrics.dotRadius * 2 + metrics.labelGap + 2
}

function nodeLeft(pos: LayoutPos) {
  return { x: pos.x - pos.width / 2, y: pos.y }
}

function nodeRight(pos: LayoutPos) {
  return { x: pos.x + pos.width / 2, y: pos.y }
}

function segmentIntersectsRect(from: Point, to: Point, rect: Rect): boolean {
  if (from.y === to.y) {
    const y = from.y
    if (y < rect.minY || y > rect.maxY) return false
    const minX = Math.min(from.x, to.x)
    const maxX = Math.max(from.x, to.x)
    return maxX >= rect.minX && minX <= rect.maxX
  }
  if (from.x === to.x) {
    const x = from.x
    if (x < rect.minX || x > rect.maxX) return false
    const minY = Math.min(from.y, to.y)
    const maxY = Math.max(from.y, to.y)
    return maxY >= rect.minY && minY <= rect.maxY
  }
  return false
}

function pathIntersectsObstacles(points: Point[], obstacles: Rect[]): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]!
    const to = points[i + 1]!
    for (const rect of obstacles) {
      if (segmentIntersectsRect(from, to, rect)) return true
    }
  }
  return false
}

function orthogonalPathHVH(from: Point, to: Point, midX: number): Point[] {
  return [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to]
}

function orthogonalPathVHV(from: Point, to: Point, midY: number): Point[] {
  return [from, { x: from.x, y: midY }, { x: to.x, y: midY }, to]
}

function pointsToSvgPath(points: Point[]): string {
  const [first, ...rest] = points
  return `M ${first!.x} ${first!.y}${rest.map((point) => ` L ${point.x} ${point.y}`).join("")}`
}

function sortByDistanceToPreferred(values: number[], preferred: number) {
  return [...values].sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred))
}

function isSameColumn(fromPos: LayoutPos, toPos: LayoutPos) {
  return Math.abs(fromPos.x - toPos.x) < 1
}

function columnSideMidX(pos: LayoutPos, metrics: GraphMetrics, offset: number) {
  return pos.x + pos.width / 2 + ROUTE_PAD * 2 + metrics.flowCurveOffset + offset
}

function midXRunsThroughColumn(midX: number, columnX: number, radius: number) {
  return Math.abs(midX - columnX) <= radius + ROUTE_PAD
}

function collectMidXCandidates(
  from: Point,
  to: Point,
  preferred: number,
  obstacles: Rect[],
  columnX?: number,
  columnRadius?: number,
) {
  const candidates = new Set<number>([preferred])
  const xMin = Math.min(from.x, to.x)
  const xMax = Math.max(from.x, to.x)
  const yMin = Math.min(from.y, to.y)
  const yMax = Math.max(from.y, to.y)

  candidates.add(xMin - ROUTE_PAD * 2)
  candidates.add(xMax + ROUTE_PAD * 2)

  if (columnX !== undefined && columnRadius !== undefined) {
    const clearance = columnRadius + ROUTE_PAD * 2
    candidates.add(columnX + clearance)
    candidates.add(columnX - clearance)
    candidates.add(columnX + clearance + ROUTE_PAD * 2)
    candidates.add(columnX - clearance - ROUTE_PAD * 2)
  }

  for (const rect of obstacles) {
    if (rect.maxY < yMin || rect.minY > yMax) continue
    if (rect.maxX < xMin - ROUTE_PAD || rect.minX > xMax + ROUTE_PAD) continue
    candidates.add(rect.minX - ROUTE_PAD)
    candidates.add(rect.maxX + ROUTE_PAD)
  }

  const sorted = sortByDistanceToPreferred([...candidates], preferred)
  if (columnX === undefined || columnRadius === undefined) return sorted
  return sorted.filter((midX) => !midXRunsThroughColumn(midX, columnX, columnRadius))
}

function collectMidYCandidates(from: Point, to: Point, preferred: number, obstacles: Rect[]) {
  const candidates = new Set<number>([preferred])
  const xMin = Math.min(from.x, to.x)
  const xMax = Math.max(from.x, to.x)
  const yMin = Math.min(from.y, to.y)
  const yMax = Math.max(from.y, to.y)

  candidates.add(yMin - ROUTE_PAD * 2)
  candidates.add(yMax + ROUTE_PAD * 2)

  for (const rect of obstacles) {
    if (rect.maxX < xMin || rect.minX > xMax) continue
    if (rect.maxY < yMin - ROUTE_PAD || rect.minY > yMax + ROUTE_PAD) continue
    candidates.add(rect.minY - ROUTE_PAD)
    candidates.add(rect.maxY + ROUTE_PAD)
  }

  return sortByDistanceToPreferred([...candidates], preferred)
}

/** Pick the LR anchor closest to the vertical routing lane at midX. */
function anchorsForMidX(fromPos: LayoutPos, toPos: LayoutPos, midX: number): { from: Point; to: Point } {
  return {
    from: midX >= fromPos.x ? nodeRight(fromPos) : nodeLeft(fromPos),
    to: midX >= toPos.x ? nodeRight(toPos) : nodeLeft(toPos),
  }
}

/** Pick the TB anchor closest to the horizontal routing lane at midY. */
function anchorsForMidY(fromPos: LayoutPos, toPos: LayoutPos, midY: number): { from: Point; to: Point } {
  const fromRadius = fromPos.width / 2
  const toRadius = toPos.width / 2
  return {
    from:
      midY >= fromPos.y
        ? { x: fromPos.x, y: fromPos.y + fromRadius }
        : { x: fromPos.x, y: fromPos.y - fromRadius },
    to:
      midY >= toPos.y
        ? { x: toPos.x, y: toPos.y + toRadius }
        : { x: toPos.x, y: toPos.y - toRadius },
  }
}

function tryRouteHVH(
  fromPos: LayoutPos,
  toPos: LayoutPos,
  offset: number,
  obstacles: Rect[],
  metrics: GraphMetrics,
): string | null {
  const sameColumn = isSameColumn(fromPos, toPos)
  const columnX = sameColumn ? fromPos.x : undefined
  const columnRadius = sameColumn ? fromPos.width / 2 : undefined
  const preferred = sameColumn
    ? columnSideMidX(fromPos, metrics, offset)
    : (fromPos.x + toPos.x) / 2 + offset
  const probe = anchorsForMidX(fromPos, toPos, preferred)

  for (const midX of collectMidXCandidates(probe.from, probe.to, preferred, obstacles, columnX, columnRadius)) {
    const anchors = anchorsForMidX(fromPos, toPos, midX)
    const points = orthogonalPathHVH(anchors.from, anchors.to, midX)
    if (!pathIntersectsObstacles(points, obstacles)) return pointsToSvgPath(points)
  }

  if (sameColumn) {
    for (const extra of [-metrics.flowCurveOffset, metrics.flowCurveOffset, metrics.flowCurveOffset * 2]) {
      const midX = columnSideMidX(fromPos, metrics, offset + extra)
      const anchors = anchorsForMidX(fromPos, toPos, midX)
      const points = orthogonalPathHVH(anchors.from, anchors.to, midX)
      if (!pathIntersectsObstacles(points, obstacles)) return pointsToSvgPath(points)
    }
  }

  return null
}

function tryRouteVHV(
  fromPos: LayoutPos,
  toPos: LayoutPos,
  offset: number,
  obstacles: Rect[],
): string | null {
  const preferred = (fromPos.y + toPos.y) / 2 + offset
  const probe = anchorsForMidY(fromPos, toPos, preferred)
  for (const midY of collectMidYCandidates(probe.from, probe.to, preferred, obstacles)) {
    const anchors = anchorsForMidY(fromPos, toPos, midY)
    const points = orthogonalPathVHV(anchors.from, anchors.to, midY)
    if (!pathIntersectsObstacles(points, obstacles)) return pointsToSvgPath(points)
  }
  return null
}


function fallbackHVHPath(
  fromPos: LayoutPos,
  toPos: LayoutPos,
  offset: number,
  obstacles: Rect[],
  metrics: GraphMetrics,
): string {
  const sameColumn = isSameColumn(fromPos, toPos)
  const preferred = sameColumn
    ? columnSideMidX(fromPos, metrics, offset)
    : (fromPos.x + toPos.x) / 2 + offset
  const columnX = sameColumn ? fromPos.x : undefined
  const columnRadius = sameColumn ? fromPos.width / 2 : undefined
  const probe = anchorsForMidX(fromPos, toPos, preferred)

  for (const midX of collectMidXCandidates(probe.from, probe.to, preferred, obstacles, columnX, columnRadius)) {
    const anchors = anchorsForMidX(fromPos, toPos, midX)
    const points = orthogonalPathHVH(anchors.from, anchors.to, midX)
    if (!pathIntersectsObstacles(points, obstacles)) return pointsToSvgPath(points)
  }

  const midX = sameColumn ? columnSideMidX(fromPos, metrics, offset) : preferred
  const anchors = anchorsForMidX(fromPos, toPos, midX)
  return pointsToSvgPath(orthogonalPathHVH(anchors.from, anchors.to, midX))
}

function routeHVHBetween(
  fromPos: LayoutPos,
  toPos: LayoutPos,
  offset: number,
  obstacles: Rect[],
  metrics: GraphMetrics,
): string {
  return tryRouteHVH(fromPos, toPos, offset, obstacles, metrics) ??
    fallbackHVHPath(fromPos, toPos, offset, obstacles, metrics)
}

/** HVH paths depart/arrive horizontally (LR anchors); VHV paths depart/arrive vertically (TB anchors). */
function routeEdgeBetween(
  fromPos: LayoutPos,
  toPos: LayoutPos,
  offset: number,
  obstacles: Rect[],
  metrics: GraphMetrics,
): string {
  const sameColumn = isSameColumn(fromPos, toPos)
  const horizontalFirst =
    sameColumn || Math.abs(fromPos.x - toPos.x) >= Math.abs(fromPos.y - toPos.y)
  const modes = horizontalFirst ? (["hvh", "vhv"] as const) : (["vhv", "hvh"] as const)

  for (const mode of modes) {
    if (mode === "vhv" && sameColumn) continue
    if (mode === "hvh") {
      const path = tryRouteHVH(fromPos, toPos, offset, obstacles, metrics)
      if (path) return path
      continue
    }
    const path = tryRouteVHV(fromPos, toPos, offset, obstacles)
    if (path) return path
  }

  return fallbackHVHPath(fromPos, toPos, offset, obstacles, metrics)
}

function nodeRouteBounds(pos: LayoutPos, metrics: GraphMetrics): Rect {
  const pad = metrics.dotRadius + ROUTE_PAD
  return {
    minX: pos.x - pad,
    maxX: pos.x + pad,
    minY: pos.y - pad,
    maxY: pos.y + pad,
  }
}

function buildNodeObstacleList(
  positions: Map<string, LayoutPos>,
  _nodesById: Map<string, PortalOrchestrationNode>,
  metrics: GraphMetrics,
): NodeObstacle[] {
  const obstacles: NodeObstacle[] = []
  for (const [nodeId, pos] of positions) {
    obstacles.push({ nodeId, rect: nodeRouteBounds(pos, metrics) })
  }
  return obstacles
}

function obstaclesExcluding(nodeObstacles: NodeObstacle[], excludeIds: string[]): Rect[] {
  const skip = new Set(excludeIds)
  return nodeObstacles.filter((item) => !skip.has(item.nodeId)).map((item) => item.rect)
}

function escapeAttr(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function escapeText(value: string) {
  return escapeAttr(value)
}

function flowMarker(state: PortalOrchestrationFlowEdge["state"], idPrefix: string) {
  if (state === "current") return `url(#${idPrefix}-arrow-current)`
  if (state === "done") return `url(#${idPrefix}-arrow-done)`
  return `url(#${idPrefix}-arrow-pending)`
}

function renderArrowMarkers(idPrefix: string, variant: OrchestrationGraphVariant) {
  const sizes =
    variant === "mini"
      ? { done: 4.5, current: 5, pending: 4 }
      : { done: 6, current: 7, pending: 5 }
  return `<marker id="${idPrefix}-arrow-done" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="${sizes.done}" markerHeight="${sizes.done}" orient="auto-start-reverse">
          <path d="M 0 0 L 8 4 L 0 8 z" class="orch-marker-done" />
        </marker>
        <marker id="${idPrefix}-arrow-current" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="${sizes.current}" markerHeight="${sizes.current}" orient="auto-start-reverse">
          <path d="M 0 0 L 8 4 L 0 8 z" class="orch-marker-current" />
        </marker>
        <marker id="${idPrefix}-arrow-pending" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="${sizes.pending}" markerHeight="${sizes.pending}" orient="auto-start-reverse">
          <path d="M 0 0 L 8 4 L 0 8 z" class="orch-marker-pending" />
        </marker>`
}

function dedupeFlowEdges(edges: PortalOrchestrationFlowEdge[]) {
  const rank = { current: 3, done: 2, pending: 1 }
  const byPair = new Map<string, PortalOrchestrationFlowEdge>()
  for (const edge of edges) {
    const key = `${edge.from}->${edge.to}`
    const existing = byPair.get(key)
    if (!existing || rank[edge.state] > rank[existing.state]) {
      byPair.set(key, edge)
    }
  }
  return [...byPair.values()]
}

function flowEdgeKind(edge: PortalOrchestrationFlowEdge): "deliverable" | "serial" | "depends" {
  return edge.kind ?? "serial"
}

function renderFlowPathMarkup(
  edge: PortalOrchestrationFlowEdge,
  path: string,
  idPrefix: string,
) {
  const kind = flowEdgeKind(edge)
  const title = flowEdgeTitle(edge)
  return `<path class="orch-graph-edge orch-graph-flow orch-flow-${edge.state} orch-flow-kind-${kind} orch-flow-op-${edge.op}" data-step-id="${escapeAttr(edge.step_id)}" marker-end="${flowMarker(edge.state, idPrefix)}" d="${path}">
          <title>${escapeText(title)}</title>
        </path>`
}

function renderMiniGraphEdges(
  orch: PortalOrchestration,
  positions: Map<string, LayoutPos>,
  idPrefix: string,
  nodesById: Map<string, PortalOrchestrationNode>,
  metrics: GraphMetrics,
) {
  const nodeObstacles = buildNodeObstacleList(positions, nodesById, metrics)
  const markup: string[] = []

  for (const edge of dedupeFlowEdges(orch.flow_edges)) {
    const fromPos = positions.get(edge.from)
    const toPos = positions.get(edge.to)
    if (!fromPos || !toPos) continue

    const obstacles = obstaclesExcluding(nodeObstacles, [edge.from, edge.to])
    const path = routeEdgeBetween(fromPos, toPos, 0, obstacles, metrics)
    markup.push(renderFlowPathMarkup(edge, path, idPrefix))
  }

  return markup
}

function flowEdgeTitle(edge: PortalOrchestrationFlowEdge) {
  const kind = flowEdgeKind(edge)
  const label =
    kind === "deliverable"
      ? t("orch.flow.deliverable")
      : kind === "depends"
        ? t("orch.flow.depends")
        : t("orch.flow.serial")
  return `${label}: ${edge.from} → ${edge.to}`
}

function nodeLabel(node: PortalOrchestrationNode) {
  return node.display_name || node.node_id
}

function resolveLabelPlacements(positions: Map<string, LayoutPos>) {
  for (const pos of positions.values()) {
    pos.labelPlacement = "above"
  }
}

type LabelLayout = {
  x: number
  y: number
  anchor: "start" | "middle" | "end"
  baseline: "auto" | "hanging" | "middle"
}

function labelLayout(pos: LayoutPos, metrics: GraphMetrics): LabelLayout {
  return {
    x: pos.x,
    y: pos.y - metrics.dotRadius - metrics.labelGap - metrics.fontSize,
    anchor: "middle",
    baseline: "hanging",
  }
}

export function applyOrchestrationGraphLabelScale(root: Element) {
  const svg = root.querySelector(".orch-graph-svg") as SVGSVGElement | null
  if (!svg) return

  const vb = svg.viewBox.baseVal
  if (vb.width <= 0 || vb.height <= 0) return

  const rect = svg.getBoundingClientRect()
  if (rect.width <= 0) return

  const scaleX = rect.width / vb.width
  const scaleY = rect.height > 0 ? rect.height / vb.height : scaleX
  const scale = Math.min(scaleX, scaleY)
  if (scale <= 0) return

  const userFontSize = resolveOrchestrationGraphLabelScreenPx(root) / scale
  for (const text of svg.querySelectorAll(".orch-graph-node-label-outside")) {
    text.setAttribute("font-size", String(userFontSize))
  }
}

/** Browser script for static HTML galleries; keep in sync with label scale helpers above. */
export function orchestrationGraphLabelScaleClientScript() {
  return `function cssLengthToScreenPx(context, length) {
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.fontSize = length;
  context.appendChild(probe);
  const px = parseFloat(getComputedStyle(probe).fontSize);
  context.removeChild(probe);
  return Number.isFinite(px) && px > 0 ? px : undefined;
}
function resolveOrchestrationGraphLabelScreenPx(root) {
  const wrap = root.querySelector(".orch-graph-wrap") ?? root;
  const custom = getComputedStyle(wrap).getPropertyValue("--orch-graph-label-size").trim();
  if (custom) {
    const px = cssLengthToScreenPx(wrap, custom);
    if (px) return px;
  }
  return ${ORCH_GRAPH_LABEL_SCREEN_PX_FALLBACK};
}
function applyOrchestrationGraphLabelScale(root) {
  const svg = root.querySelector(".orch-graph-svg");
  if (!svg) return;
  const vb = svg.viewBox.baseVal;
  if (vb.width <= 0 || vb.height <= 0) return;
  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0) return;
  const scaleX = rect.width / vb.width;
  const scaleY = rect.height > 0 ? rect.height / vb.height : scaleX;
  const scale = Math.min(scaleX, scaleY);
  if (scale <= 0) return;
  const userFontSize = resolveOrchestrationGraphLabelScreenPx(root) / scale;
  for (const text of svg.querySelectorAll(".orch-graph-node-label-outside")) {
    text.setAttribute("font-size", String(userFontSize));
  }
}`
}

function labelHalfWidth(text: string, fontSize: number) {
  return (text.length * fontSize * 0.58) / 2
}

function preserveAspectRatio() {
  return "xMidYMid meet"
}

function nodeVisualBounds(pos: LayoutPos, metrics: GraphMetrics, label: string) {
  const halfW = Math.max(pos.width / 2, labelHalfWidth(label, metrics.fontSize))
  const minX = pos.x - halfW
  const maxX = pos.x + halfW
  const minY = Math.min(
    pos.y - pos.height / 2,
    pos.y - metrics.dotRadius - metrics.labelGap - metrics.fontSize,
  )
  const maxY = pos.y + pos.height / 2

  return { minX, maxX, minY, maxY }
}

function computeBounds(
  positions: Map<string, LayoutPos>,
  metrics: GraphMetrics,
  nodesById: Map<string, PortalOrchestrationNode>,
) {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (const [nodeId, pos] of positions) {
    const node = nodesById.get(nodeId)
    const label = node ? nodeLabel(node) : ""
    const bounds = nodeVisualBounds(pos, metrics, label)
    minX = Math.min(minX, bounds.minX)
    maxX = Math.max(maxX, bounds.maxX)
    minY = Math.min(minY, bounds.minY)
    maxY = Math.max(maxY, bounds.maxY)
  }

  if (!Number.isFinite(minX) || positions.size === 0) {
    return { minX: 0, minY: 0, width: 120, height: 80 }
  }

  const edgePad = 6
  const sidePad = Math.max(metrics.padding, 10) + edgePad
  const vertPad = Math.max(metrics.padding, 8) + edgePad
  return {
    minX: minX - sidePad,
    minY: minY - vertPad,
    width: maxX - minX + sidePad * 2,
    height: maxY - minY + vertPad * 2,
  }
}

function renderMiniDotNode(
  node: PortalOrchestrationNode,
  pos: LayoutPos,
  metrics: GraphMetrics,
  isRoot: boolean,
) {
  const statusLabel = t(`orch.nodeStatus.${node.status}`)
  const fullLabel = nodeLabel(node)
  const layout = labelLayout(pos, metrics)

  return `<g class="orch-graph-node orch-graph-node-dot orch-status-${node.status}${isRoot ? " orch-node-terminal" : ""}" data-node-id="${escapeAttr(node.node_id)}">
    <title>${escapeText(`${node.node_id} · ${statusLabel}${node.skill_domain ? ` · ${node.skill_domain}` : ""}`)}</title>
    <text class="orch-graph-node-label orch-graph-node-label-outside" x="${layout.x}" y="${layout.y}" text-anchor="${layout.anchor}" dominant-baseline="${layout.baseline}" font-size="${metrics.fontSize}">${escapeText(fullLabel)}</text>
    <circle class="orch-graph-node-dot-shape" cx="${pos.x}" cy="${pos.y}" r="${metrics.dotRadius}" />
  </g>`
}

export function renderOrchestrationGraph(
  orch: PortalOrchestration,
  variant: OrchestrationGraphVariant,
  idPrefix = `orch-${variant}`,
) {
  const nodeIds = orch.nodes.map((node) => node.node_id)
  const layers = computePlanNodeLayers(nodeIds, orch.flow_edges, orch.activation_order)
  const maxDepth = maxPlanLayoutDepth(layers)
  const maxWidth = maxPlanLayoutWidth(layers)
  const metrics = metricsForVariant(variant, orch.nodes.length, maxDepth, maxWidth)
  const { positions } = layoutPlanFlow(orch, metrics)
  stretchMiniLayoutHorizontally(positions, metrics)
  resolveLabelPlacements(positions)
  const nodesById = new Map(orch.nodes.map((node) => [node.node_id, node]))
  const bounds = computeBounds(positions, metrics, nodesById)
  const viewBox = `${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`
  const aspect = preserveAspectRatio()
  const edgeMarkup = renderMiniGraphEdges(orch, positions, idPrefix, nodesById, metrics)

  const nodeMarkup: string[] = []
  for (const node of orch.nodes) {
    const pos = positions.get(node.node_id)
    if (!pos) continue
    const isRoot = node.node_id === orch.terminal_node
    nodeMarkup.push(renderMiniDotNode(node, pos, metrics, isRoot))
  }

  const wrapClass =
    variant === "mini" ? "orch-graph-wrap orch-graph-wrap-mini" : "orch-graph-wrap orch-graph-wrap-expanded"

  return `<div class="${wrapClass}">
    <svg class="orch-graph-svg orch-graph-svg-${variant}" viewBox="${viewBox}" preserveAspectRatio="${aspect}" role="img" aria-label="${escapeAttr(t("orch.graphLabel"))}">
      <defs>
        ${renderArrowMarkers(idPrefix, variant)}
      </defs>
      <g class="orch-graph-edge-layer">${edgeMarkup.join("")}</g>
      <g class="orch-graph-node-layer">${nodeMarkup.join("")}</g>
    </svg>
  </div>`
}
