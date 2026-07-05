#!/usr/bin/env bun
/**
 * Generate a standalone HTML gallery of orchestration graph renders for visual QA.
 *
 *   bun script/generate-orchestration-graph-gallery.ts
 *   open packages/portal/orchestration-graph-gallery.html
 */
import "./mock-browser-globals.ts"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { dryRunMissionScriptSource } from "../../core/src/orchestration/script-validate.ts"
import type { OrchestrationPlan } from "../../core/src/orchestration/plan-types.ts"
import type { ParsedMissionScript } from "../../core/src/orchestration/script-parse.ts"
import type { OrchestrationNodeStatus } from "../../core/src/orchestration/types.ts"
import { buildPortalOrchestrationFlowEdges } from "../../core/src/portal/orchestration-flow-edges.ts"
import { listPlanRunActivations, teamNodeOrder } from "../../core/src/orchestration/plan-graph.ts"
import { SCRIPT } from "../../core/test/orchestration-replay-harness.ts"
import {
  orchestrationGraphLabelScaleClientScript,
  renderOrchestrationGraph,
} from "../src/shell/orchestration-graph.ts"
import { setLocale } from "../src/shell/i18n.ts"
import type { PortalOrchestration } from "../src/api/types.ts"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const portalDir = path.resolve(scriptDir, "..")
const outPath = path.join(portalDir, "orchestration-graph-gallery.html")

type GallerySnapshot = {
  label: string
  cursorStepIndex: number
  nodeStatuses?: Partial<Record<string, OrchestrationNodeStatus>>
}

type GalleryCase = {
  title: string
  description: string
  buildScript: (missionId: string) => string
  snapshots: GallerySnapshot[]
}

const EXTRA_SCRIPTS = {
  siblingSerial(missionId: string) {
    return `
export const team = {
  mission_id: "${missionId}",
  terminal: "root",
  nodes: {
    root: { description: "root" },
    lead: { description: "lead coord" },
    a: { description: "worker a" },
    b: { description: "worker b" },
    c: { description: "worker c" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.run("a", { brief: { your_work: ["a"], acceptance_slice: [] }, text: "go a" })
  await ctx.run("b", { brief: { your_work: ["b"], acceptance_slice: [] }, text: "go b" })
  await ctx.run("c", { brief: { your_work: ["c"], acceptance_slice: [] }, text: "go c" })
  await ctx.run("lead", {
    brief: { your_work: ["synthesize"], acceptance_slice: [] },
    text: "synthesize lead",
    dependsOn: [{ node: "a", deliverable: true }, { node: "b", deliverable: true }, { node: "c", deliverable: true }],
  })
  await ctx.run("root", {
    brief: { your_work: ["final"], acceptance_slice: [] },
    text: "final",
    dependsOn: [{ node: "lead", deliverable: true }],
  })
}
`
  },

  crossParentDepends(missionId: string) {
    return `
export const team = {
  mission_id: "${missionId}",
  terminal: "root",
  nodes: {
    root: { description: "root" },
    a: { description: "branch a" },
    b: { description: "branch b" },
    a1: { description: "a leaf" },
    b1: { description: "b leaf" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.parallel([
    async () => {
      await ctx.run("a1", { brief: { your_work: ["a1"], acceptance_slice: [] }, text: "go a1" })
      await ctx.run("a", {
        brief: { your_work: ["synthesize a"], acceptance_slice: [] },
        text: "synthesize a",
        dependsOn: [{ node: "a1", deliverable: true }],
      })
    },
    async () => {
      await ctx.run("b1", {
        brief: { your_work: ["b1"], acceptance_slice: [] },
        text: "go b1",
        dependsOn: ["a1"],
      })
      await ctx.run("b", {
        brief: { your_work: ["synthesize b"], acceptance_slice: [] },
        text: "synthesize b",
        dependsOn: [{ node: "b1", deliverable: true }],
      })
    },
  ])
  await ctx.run("root", {
    brief: { your_work: ["final"], acceptance_slice: [] },
    text: "final",
    dependsOn: [{ node: "a", deliverable: true }, { node: "b", deliverable: true }],
  })
}
`
  },

  wideFanOut(missionId: string) {
    const leaves = Array.from({ length: 8 }, (_, i) => `w${i + 1}`)
    const nodeEntries = [
      `root: { description: "root" }`,
      `coord: { description: "synthesis node" }`,
      ...leaves.map((id) => `${id}: { description: "${id}" }`),
    ].join(",\n    ")
    const parallelTracks = leaves
      .map(
        (id) => `    async () => {
      await ctx.run("${id}", { brief: { your_work: ["${id}"], acceptance_slice: [] }, text: "go ${id}" })
    }`,
      )
      .join(",\n")
    const depends = leaves.map((id) => `{ node: "${id}", deliverable: true }`).join(", ")
    return `
export const team = {
  mission_id: "${missionId}",
  terminal: "root",
  nodes: {
    ${nodeEntries}
  },
}
export default async function orchestrate(ctx) {
  await ctx.parallel([
${parallelTracks}
  ])
  await ctx.run("coord", {
    brief: { your_work: ["synthesize"], acceptance_slice: [] },
    text: "coord synthesis",
    dependsOn: [${depends}],
  })
  await ctx.run("root", {
    brief: { your_work: ["final"], acceptance_slice: [] },
    text: "final",
    dependsOn: [{ node: "coord", deliverable: true }],
  })
}
`
  },

  nestedDualParallel(missionId: string) {
    return `
export const team = {
  mission_id: "${missionId}",
  terminal: "root",
  nodes: {
    root: { description: "root" },
    "research-lead": { description: "research lead" },
    "analysis-lead": { description: "analysis lead" },
    "gpt-researcher": { description: "gpt" },
    "claude-researcher": { description: "claude" },
    "benchmark-analyst": { description: "benchmark" },
    "pricing-analyst": { description: "pricing" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.parallel([
    async () => {
      await ctx.run("gpt-researcher", { brief: { your_work: ["gpt"], acceptance_slice: [] }, text: "go" })
      await ctx.run("claude-researcher", { brief: { your_work: ["claude"], acceptance_slice: [] }, text: "go" })
      await ctx.run("research-lead", {
        brief: { your_work: ["research synthesis"], acceptance_slice: [] },
        text: "synthesize",
        dependsOn: [{ node: "gpt-researcher", deliverable: true }, { node: "claude-researcher", deliverable: true }],
      })
    },
    async () => {
      await ctx.run("benchmark-analyst", { brief: { your_work: ["bench"], acceptance_slice: [] }, text: "go" })
      await ctx.run("pricing-analyst", { brief: { your_work: ["price"], acceptance_slice: [] }, text: "go" })
      await ctx.run("analysis-lead", {
        brief: { your_work: ["analysis synthesis"], acceptance_slice: [] },
        text: "synthesize",
        dependsOn: [{ node: "benchmark-analyst", deliverable: true }, { node: "pricing-analyst", deliverable: true }],
      })
    },
  ])
  await ctx.run("root", {
    brief: { your_work: ["final"], acceptance_slice: [] },
    text: "final",
    dependsOn: [{ node: "research-lead", deliverable: true }, { node: "analysis-lead", deliverable: true }],
  })
}
`
  },

  deepFiveLevel(missionId: string) {
    return `
export const team = {
  mission_id: "${missionId}",
  terminal: "l5",
  nodes: {
    l5: { description: "L5 root" },
    l4a: { description: "L4 branch A" },
    l4b: { description: "L4 branch B" },
    l3a: { description: "L3 A" },
    l3b: { description: "L3 B" },
    l2a: { description: "L2 A" },
    l2b: { description: "L2 B" },
    l1a: { description: "leaf A" },
    l1b: { description: "leaf B" },
    l1c: { description: "leaf C" },
    l1d: { description: "leaf D" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.parallel([
    async () => {
      await ctx.parallel([
        async () => { await ctx.run("l1a", { brief: { your_work: ["l1a"], acceptance_slice: [] }, text: "go" }) },
        async () => { await ctx.run("l1b", { brief: { your_work: ["l1b"], acceptance_slice: [] }, text: "go" }) },
      ])
      await ctx.run("l2a", {
        brief: { your_work: ["l2a"], acceptance_slice: [] },
        text: "synthesize",
        dependsOn: [{ node: "l1a", deliverable: true }, { node: "l1b", deliverable: true }],
      })
      await ctx.run("l3a", {
        brief: { your_work: ["l3a"], acceptance_slice: [] },
        text: "synthesize",
        dependsOn: [{ node: "l2a", deliverable: true }],
      })
      await ctx.run("l4a", {
        brief: { your_work: ["l4a"], acceptance_slice: [] },
        text: "synthesize",
        dependsOn: [{ node: "l3a", deliverable: true }],
      })
    },
    async () => {
      await ctx.parallel([
        async () => { await ctx.run("l1c", { brief: { your_work: ["l1c"], acceptance_slice: [] }, text: "go" }) },
        async () => { await ctx.run("l1d", { brief: { your_work: ["l1d"], acceptance_slice: [] }, text: "go" }) },
      ])
      await ctx.run("l2b", {
        brief: { your_work: ["l2b"], acceptance_slice: [] },
        text: "synthesize",
        dependsOn: [{ node: "l1c", deliverable: true }, { node: "l1d", deliverable: true }],
      })
      await ctx.run("l3b", {
        brief: { your_work: ["l3b"], acceptance_slice: [] },
        text: "synthesize",
        dependsOn: [{ node: "l2b", deliverable: true }],
      })
      await ctx.run("l4b", {
        brief: { your_work: ["l4b"], acceptance_slice: [] },
        text: "synthesize",
        dependsOn: [{ node: "l3b", deliverable: true }],
      })
    },
  ])
  await ctx.run("l5", {
    brief: { your_work: ["final"], acceptance_slice: [] },
    text: "final",
    dependsOn: [{ node: "l4a", deliverable: true }, { node: "l4b", deliverable: true }],
  })
}
`
  },

  problemStatuses(missionId: string) {
    return SCRIPT.dualTrackIntraFanOut(missionId)
  },
}

const GALLERY_CASES: GalleryCase[] = [
  {
    title: "线性三层汇总",
    description: "leaf → mid → root 串行汇总",
    buildScript: SCRIPT.linearThreeStep,
    snapshots: [
      { label: "步骤 0：叶子执行中", cursorStepIndex: 0 },
      { label: "步骤 1：中层汇总中", cursorStepIndex: 1 },
      { label: "全部完成", cursorStepIndex: 3 },
    ],
  },
  {
    title: "双轨 parallel · 轨内串行",
    description: "两组并行，每组内 a1→a2→汇总",
    buildScript: SCRIPT.dualTrackParallelFinal,
    snapshots: [
      { label: "parallel 启动：A/B 首步并行", cursorStepIndex: 0 },
      { label: "A 轨完成，B 轨执行中", cursorStepIndex: 0, nodeStatuses: { a1: "done", a2: "done", a: "done", b1: "done", b2: "running" } },
      { label: "双轨完成，root 汇总中", cursorStepIndex: 1, nodeStatuses: { a1: "done", a2: "done", a: "done", b1: "done", b2: "done", b: "done" } },
    ],
  },
  {
    title: "双轨 · 组内 fan-out",
    description: "双轨 parallel，每轨内叶子并行后 join",
    buildScript: SCRIPT.dualTrackIntraFanOut,
    snapshots: [
      { label: "四叶子并行执行", cursorStepIndex: 0 },
      { label: "A 轨汇总中", cursorStepIndex: 0, nodeStatuses: { a1: "done", a2: "done", a: "running", b1: "running", b2: "pending" } },
      { label: "全部完成", cursorStepIndex: 2 },
    ],
  },
  {
    title: "深层 4 层 hierarchy",
    description: "底层 fan-out → 逐层汇总到 terminal",
    buildScript: SCRIPT.deepHierarchyFanOut,
    snapshots: [
      { label: "叶子 fan-out", cursorStepIndex: 0 },
      { label: "L2 汇总中", cursorStepIndex: 1 },
      { label: "L4 最终汇总", cursorStepIndex: 3 },
    ],
  },
  {
    title: "组内 compound 多轮",
    description: "fan-out 后对同一协调节点两轮 run",
    buildScript: SCRIPT.intraFanOutCompoundMultiRound,
    snapshots: [
      { label: "x1/x2 并行", cursorStepIndex: 0 },
      { label: "coord 第二轮", cursorStepIndex: 0, nodeStatuses: { x1: "done", x2: "done", coord: "running" } },
    ],
  },
  {
    title: "双轨 + root 多轮",
    description: "并行完成后 root 连续两轮",
    buildScript: SCRIPT.dualTrackThenRootMultiRound,
    snapshots: [
      { label: "A/B 并行执行", cursorStepIndex: 0 },
      { label: "root 第二轮", cursorStepIndex: 2 },
    ],
  },
  {
    title: "三路并行 fan-out join",
    description: "三个 playbook 并行后 root 汇总",
    buildScript: SCRIPT.fanOutJoin,
    snapshots: [
      { label: "a/b 完成，root 等待", cursorStepIndex: 1, nodeStatuses: { a: "done", b: "running" } },
      { label: "全部完成", cursorStepIndex: 2 },
    ],
  },
  {
    title: "嵌套 parallel 链",
    description: "parallel 内 a1→a2 串行后 root 汇总",
    buildScript: SCRIPT.parallelThenFinal,
    snapshots: [
      { label: "a1 执行中", cursorStepIndex: 0, nodeStatuses: { a1: "running", a2: "pending" } },
      { label: "a2 执行中", cursorStepIndex: 0, nodeStatuses: { a1: "done", a2: "running" } },
      { label: "root 汇总", cursorStepIndex: 1 },
    ],
  },
  {
    title: "同节点多轮 compound",
    description: "parallel 单轨内对同一节点连续两轮 run",
    buildScript: SCRIPT.parallelMultiRoundSameNode,
    snapshots: [
      { label: "第一轮", cursorStepIndex: 0 },
      { label: "第二轮", cursorStepIndex: 0, nodeStatuses: { a: "running" } },
    ],
  },
  {
    title: "兄弟节点串行",
    description: "同父下 a→b→c 串行后 lead/root 汇总",
    buildScript: EXTRA_SCRIPTS.siblingSerial,
    snapshots: [
      { label: "b 执行中（a 已完成）", cursorStepIndex: 1, nodeStatuses: { a: "done", b: "running" } },
      { label: "lead 汇总", cursorStepIndex: 3 },
    ],
  },
  {
    title: "跨父级 dependsOn",
    description: "b1 依赖 a1（不同分支）",
    buildScript: EXTRA_SCRIPTS.crossParentDepends,
    snapshots: [
      { label: "a1 完成，b1 等待依赖", cursorStepIndex: 0, nodeStatuses: { a1: "done", b1: "pending" } },
      { label: "b1 执行中", cursorStepIndex: 0, nodeStatuses: { a1: "done", b1: "running" } },
    ],
  },
  {
    title: "8 路宽 fan-out",
    description: "同一协调节点下 8 个并行叶子",
    buildScript: EXTRA_SCRIPTS.wideFanOut,
    snapshots: [
      { label: "8 叶子并行", cursorStepIndex: 0 },
      { label: "coord synthesis", cursorStepIndex: 1, nodeStatuses: { w1: "done", w2: "done", w3: "done", w4: "done", w5: "done", w6: "done", w7: "done", w8: "done", coord: "running" } },
    ],
  },
  {
    title: "研究 + 分析双轨 nested parallel",
    description: "flow-edges 测试中的经典双组结构",
    buildScript: EXTRA_SCRIPTS.nestedDualParallel,
    snapshots: [
      { label: "research 轨 gpt 完成", cursorStepIndex: 0, nodeStatuses: { "gpt-researcher": "done", "claude-researcher": "running" } },
      { label: "双轨均完成", cursorStepIndex: 0, nodeStatuses: { "gpt-researcher": "done", "claude-researcher": "done", "research-lead": "done", "benchmark-analyst": "done", "pricing-analyst": "done", "analysis-lead": "done" } },
      { label: "root 最终汇总", cursorStepIndex: 1 },
    ],
  },
  {
    title: "5 层深 + 双分支",
    description: "两棵深树并行 fan-in 到 L5",
    buildScript: EXTRA_SCRIPTS.deepFiveLevel,
    snapshots: [
      { label: "底层 4 叶子并行", cursorStepIndex: 0 },
      { label: "L2 汇总阶段", cursorStepIndex: 0, nodeStatuses: { l1a: "done", l1b: "done", l2a: "running", l1c: "done", l1d: "running" } },
      { label: "L5 最终汇总", cursorStepIndex: 1 },
    ],
  },
  {
    title: "异常状态：blocked / rework",
    description: "双轨 fan-out 中途出现阻塞与返工",
    buildScript: EXTRA_SCRIPTS.problemStatuses,
    snapshots: [
      {
        label: "a2 blocked，b1 rework",
        cursorStepIndex: 0,
        nodeStatuses: { a1: "done", a2: "blocked", b1: "rework", b2: "running" },
      },
    ],
  },
]

function extractRunTargets(statement: string) {
  const targets: string[] = []
  const pattern = /ctx\.run\s*\(\s*["'`]([^"'`]+)["'`]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(statement)) !== null) {
    targets.push(match[1]!)
  }
  return targets
}

function inferNodeStatuses(
  plan: OrchestrationPlan,
  cursorStepIndex: number,
  nodeIds: string[],
): Record<string, OrchestrationNodeStatus> {
  const statuses = Object.fromEntries(nodeIds.map((id) => [id, "pending" as const])) as Record<
    string,
    OrchestrationNodeStatus
  >

  if (cursorStepIndex >= plan.steps.length) {
    for (const id of nodeIds) statuses[id] = "done"
    return statuses
  }

  for (let i = 0; i < cursorStepIndex; i += 1) {
    for (const target of extractRunTargets(plan.steps[i]!.statement)) {
      statuses[target] = "done"
    }
  }

  const current = plan.steps[cursorStepIndex]
  if (current) {
    for (const target of extractRunTargets(current.statement)) {
      statuses[target] = "running"
    }
  }

  return statuses
}

function buildGalleryOrch(
  parsed: ParsedMissionScript,
  plan: OrchestrationPlan,
  snapshot: GallerySnapshot,
): PortalOrchestration {
  const nodeIds = teamNodeOrder(parsed.team)
  const cursor = Math.min(snapshot.cursorStepIndex, plan.steps.length)
  const stepStates = plan.steps.map((_, index) => {
    if (index < cursor) return "done" as const
    if (index === cursor && cursor < plan.steps.length) return "current" as const
    return "pending" as const
  })

  const flow_edges = buildPortalOrchestrationFlowEdges(plan.steps, stepStates)
  const activation_order = listPlanRunActivations(plan).map((activation) => activation.targetNodeId)

  const inferred = inferNodeStatuses(plan, cursor, nodeIds)
  const nodes = nodeIds.map((nodeId) => {
    const spec = parsed.team.nodes[nodeId]!
    return {
      node_id: nodeId,
      display_name: spec.description || nodeId,
      status: snapshot.nodeStatuses?.[nodeId] ?? inferred[nodeId] ?? "pending",
    }
  })

  return {
    mission_id: parsed.team.mission_id,
    active: true,
    cursor_step_index: cursor,
    total_steps: plan.steps.length,
    completed_steps: cursor,
    phases: [],
    steps: plan.steps.map((step, index) => ({
      id: step.id,
      op: step.op,
      state: stepStates[index]!,
      ...(step.nodeId && { node_id: step.nodeId }),
    })),
    flow_edges,
    activation_order,
    nodes,
    terminal_node: parsed.team.terminal,
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

async function extractOrchCss() {
  const cssPath = path.join(portalDir, "src/shell/portal.css")
  const full = await readFile(cssPath, "utf8")
  const blocks: string[] = []
  const selectors = [
    ":root",
    ".orch-graph",
    ".orch-graph-wrap",
    ".orch-graph-svg",
    ".orch-graph-edge",
    ".orch-graph-structural",
    ".orch-graph-flow",
    ".orch-flow-",
    ".orch-marker-",
    ".orch-graph-node",
    "@keyframes orch-flow-pulse",
  ]
  let capture = false
  let braceDepth = 0
  let current = ""

  for (const line of full.split("\n")) {
    const trimmed = line.trim()
    if (!capture) {
      if (selectors.some((sel) => trimmed.startsWith(sel) || trimmed.includes(sel))) {
        capture = true
        current = line + "\n"
        braceDepth = (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length
        if (braceDepth <= 0 && line.includes("}")) {
          blocks.push(current)
          capture = false
          current = ""
        }
        continue
      }
      if (trimmed.startsWith(":root")) {
        capture = true
        current = line + "\n"
        braceDepth = (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length
      }
      continue
    }

    current += line + "\n"
    braceDepth += (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length
    if (braceDepth <= 0) {
      blocks.push(current)
      capture = false
      current = ""
    }
  }

  if (blocks.length < 5) {
    const orchSection = full.match(/\/\*[\s\S]*?orchestration[\s\S]*?\*\/[\s\S]*?(?=\n\/\*|\n\.[a-z-]+(?![\w-]*orch))/i)
    if (orchSection) return orchSection[0]
    return full.slice(0, 120_000)
  }

  return blocks.join("\n")
}

async function main() {
  setLocale("zh")

  const css = await extractOrchCss()
  const panels: string[] = []
  let index = 0

  for (const testCase of GALLERY_CASES) {
    const missionId = `gallery-${index + 1}`
    const source = testCase.buildScript(missionId)
    const dry = await dryRunMissionScriptSource(source, missionId)
    if (!dry.ok) {
      throw new Error(`Case "${testCase.title}" failed validation: ${dry.code} ${dry.message}`)
    }

    for (const snapshot of testCase.snapshots) {
      index += 1
      const orch = buildGalleryOrch(dry.parsed, dry.plan, snapshot)
      const miniId = `gallery-${index}-mini`
      const expandedId = `gallery-${index}-expanded`
      const miniHtml = renderOrchestrationGraph(orch, "mini", miniId)
      const expandedHtml = renderOrchestrationGraph(orch, "expanded", expandedId)

      panels.push(`<section class="gallery-panel" id="case-${index}">
  <header class="gallery-panel-head">
    <span class="gallery-index">${index}</span>
    <div>
      <h2>${escapeHtml(testCase.title)}</h2>
      <p class="gallery-desc">${escapeHtml(testCase.description)} · ${escapeHtml(snapshot.label)}</p>
      <p class="gallery-meta">cursor=${snapshot.cursorStepIndex} · nodes=${orch.nodes.length} · edges=${orch.flow_edges.length} · steps=${orch.total_steps}</p>
    </div>
  </header>
  <div class="gallery-graphs">
    <figure class="gallery-figure">
      <figcaption>mini 预览</figcaption>
      <div class="gallery-graph-host gallery-graph-mini" data-graph-host>${miniHtml}</div>
    </figure>
    <figure class="gallery-figure">
      <figcaption>expanded 展开</figcaption>
      <div class="gallery-graph-host gallery-graph-expanded" data-graph-host>${expandedHtml}</div>
    </figure>
  </div>
</section>`)
    }
  }

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>编排图展示测试 · Gatehouse Portal</title>
  <style>
    ${css}
    body {
      background: var(--bg, #1a2218);
      color: var(--text, #e8d48b);
      font-family: "Noto Sans SC", "Segoe UI", "PingFang SC", sans-serif;
      margin: 0;
      padding: 24px;
    }
    .gallery-header {
      max-width: 1400px;
      margin: 0 auto 32px;
    }
    .gallery-header h1 {
      font-size: 1.5rem;
      margin: 0 0 8px;
    }
    .gallery-header p {
      color: rgba(232, 212, 139, 0.72);
      margin: 0;
      line-height: 1.5;
    }
    .gallery-toc {
      max-width: 1400px;
      margin: 0 auto 32px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .gallery-toc a {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 2rem;
      padding: 4px 10px;
      border: 1px solid rgba(107, 90, 72, 0.65);
      border-radius: 6px;
      color: var(--text, #e8d48b);
      text-decoration: none;
      font-weight: 600;
      background: rgba(45, 58, 40, 0.6);
    }
    .gallery-toc a:hover {
      border-color: var(--accent, #fcd34d);
    }
    .gallery-panel {
      max-width: 1400px;
      margin: 0 auto 40px;
      border: 1px solid rgba(107, 90, 72, 0.55);
      border-radius: 12px;
      background: rgba(45, 58, 40, 0.55);
      overflow: hidden;
    }
    .gallery-panel-head {
      display: flex;
      gap: 16px;
      align-items: flex-start;
      padding: 16px 20px;
      border-bottom: 1px solid rgba(107, 90, 72, 0.45);
    }
    .gallery-index {
      flex-shrink: 0;
      width: 2.5rem;
      height: 2.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      background: rgba(252, 211, 77, 0.15);
      border: 2px solid var(--accent, #fcd34d);
      color: var(--accent, #fcd34d);
      font-weight: 700;
      font-size: 1.1rem;
    }
    .gallery-panel-head h2 {
      margin: 0 0 4px;
      font-size: 1.05rem;
    }
    .gallery-desc, .gallery-meta {
      margin: 0;
      font-size: 0.85rem;
      color: rgba(232, 212, 139, 0.72);
    }
    .gallery-meta {
      margin-top: 4px;
      font-family: ui-monospace, monospace;
      font-size: 0.78rem;
    }
    .gallery-graphs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
    }
    @media (max-width: 960px) {
      .gallery-graphs { grid-template-columns: 1fr; }
    }
    .gallery-figure {
      margin: 0;
      padding: 16px;
      border-right: 1px solid rgba(107, 90, 72, 0.35);
    }
    .gallery-figure:last-child { border-right: none; }
    .gallery-figure figcaption {
      font-size: 0.8rem;
      color: rgba(232, 212, 139, 0.62);
      margin-bottom: 10px;
    }
    .gallery-graph-host {
      background: rgba(26, 34, 24, 0.65);
      border-radius: 8px;
      padding: 12px;
      min-height: 180px;
    }
    .gallery-graph-expanded {
      min-height: 280px;
    }
    .gallery-graph-expanded .orch-graph-wrap-expanded {
      width: 100%;
      min-height: 240px;
    }
    .gallery-graph-expanded .orch-graph-svg-expanded {
      width: 100%;
      height: auto;
      max-height: 360px;
    }
  </style>
</head>
<body>
  <header class="gallery-header">
    <h1>编排图展示测试样例</h1>
    <p>共 ${index} 张图，覆盖线性汇总、双轨 parallel、组内 fan-out、深层 hierarchy、跨父依赖、宽 fan-out、异常状态等结构。每张含 mini 与 expanded 两种渲染。</p>
  </header>
  <nav class="gallery-toc" aria-label="跳转序号">
    ${Array.from({ length: index }, (_, i) => `<a href="#case-${i + 1}">${i + 1}</a>`).join("\n    ")}
  </nav>
  ${panels.join("\n")}
  <script>
    ${orchestrationGraphLabelScaleClientScript()}
    function syncAllGraphLabels() {
      document.querySelectorAll("[data-graph-host]").forEach((host) => {
        applyOrchestrationGraphLabelScale(host);
      });
    }
    syncAllGraphLabels();
    window.addEventListener("resize", syncAllGraphLabels);
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => syncAllGraphLabels());
      document.querySelectorAll("[data-graph-host]").forEach((el) => ro.observe(el));
    }
  </script>
</body>
</html>`

  await writeFile(outPath, html, "utf8")
  console.log(`Wrote ${index} graph panels to ${outPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
