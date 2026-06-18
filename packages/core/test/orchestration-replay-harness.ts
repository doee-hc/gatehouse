import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { mergeAndSaveBrief } from "../src/orchestration/events.ts"
import { orchestrationComplete } from "../src/orchestration/events.ts"
import { saveMissionScriptRecord } from "../src/orchestration/context.ts"
import { saveOrchestrationPlanRecord } from "../src/orchestration/plan-store.ts"
import { loadMissionScript } from "../src/orchestration/script-load.ts"
import type { LoadedMissionScript } from "../src/orchestration/types.ts"
import {
  initOrchestrationState,
  readOrchestrationState,
  writeOrchestrationState,
} from "../src/orchestration/state.ts"
import { getRegistryStore } from "../src/registry/context.ts"
import type { RegistryStore } from "../src/registry/store.ts"
import type { GatehouseClient } from "../src/session/client.ts"
import { topologicalNodeOrder } from "../src/tree/parse.ts"
import type { TeamSpec, TreeManifest } from "../src/tree/types.ts"

export type ReplayTestEnv = {
  dir: string
  missionId: string
  plugin: PluginInput
  store: RegistryStore
  script: LoadedMissionScript
  manifest: TreeManifest
  promptTexts: string[]
  promptsByNode: Map<string, string[]>
}

export async function waitForPromptMarker(
  env: ReplayTestEnv,
  marker: string,
  opts?: { timeoutMs?: number; intervalMs?: number; label?: string },
) {
  const timeoutMs = opts?.timeoutMs ?? 12_000
  const intervalMs = opts?.intervalMs ?? 50
  const start = Date.now()
  while (true) {
    await env.store.flushPendingDeliveries()
    if (countPromptMarkers(env.promptTexts, marker) >= 1) return
    if (Date.now() - start > timeoutMs) {
      throw new Error(opts?.label ?? `timed out waiting for prompt marker ${marker}`)
    }
    await Bun.sleep(intervalMs)
  }
}

export async function waitUntil(
  predicate: () => boolean,
  opts?: { timeoutMs?: number; intervalMs?: number; label?: string },
) {
  const timeoutMs = opts?.timeoutMs ?? 8_000
  const intervalMs = opts?.intervalMs ?? 50
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(opts?.label ?? "waitUntil timed out")
    }
    await Bun.sleep(intervalMs)
  }
}

export function countPromptMarkers(promptTexts: readonly string[], marker: string) {
  return promptTexts.filter((text) => text.includes(marker)).length
}

export function teamManifest(team: TeamSpec): TreeManifest {
  const nodes: TreeManifest["nodes"] = {}
  for (const nodeId of topologicalNodeOrder(team)) {
    const spec = team.nodes[nodeId]!
    nodes[nodeId] = {
      session_id: `ses_${nodeId}`,
      parent: spec.parent,
      description: spec.description,
    }
  }
  return {
    mission_id: team.mission_id,
    status: "running",
    root_node: team.root,
    created_at: new Date().toISOString(),
    nodes,
  }
}

function createMockClient(capture: { promptTexts: string[]; promptsByNode: Map<string, string[]> }) {
  let sessionCounter = 0
  const sessionToNode = new Map<string, string>()

  const mockClient: GatehouseClient = {
    session: {
      async create() {
        sessionCounter += 1
        return { id: `ses_${sessionCounter}` }
      },
      async promptAsync(input: { sessionID?: string; body?: { parts?: { text?: string }[] } }) {
        const text = input.body?.parts?.[0]?.text ?? ""
        capture.promptTexts.push(text)
        const sessionId = input.sessionID
        if (sessionId) {
          const nodeId = sessionToNode.get(sessionId)
          if (nodeId) {
            const list = capture.promptsByNode.get(nodeId) ?? []
            list.push(text)
            capture.promptsByNode.set(nodeId, list)
          }
        }
      },
      async messages() {
        return { data: [] }
      },
      async get() {
        return { data: {} }
      },
      async status() {
        return { data: {} }
      },
    },
  }

  return {
    client: mockClient,
    bindSession(nodeId: string, sessionId: string) {
      sessionToNode.set(sessionId, nodeId)
    },
  }
}

export async function createReplayTestEnv(input: {
  missionId: string
  scriptSource: string
}): Promise<ReplayTestEnv> {
  const dir = await mkdtemp(path.join(tmpdir(), "gh-replay-int-"))
  const missionDir = path.join(dir, ".gatehouse/trees", input.missionId)
  await mkdir(missionDir, { recursive: true })
  await writeFile(path.join(missionDir, "mission.script.ts"), input.scriptSource, "utf8")

  const promptTexts: string[] = []
  const promptsByNode = new Map<string, string[]>()
  const { client, bindSession } = createMockClient({ promptTexts, promptsByNode })
  const plugin = { directory: dir, client } as unknown as PluginInput
  const store = await getRegistryStore(plugin)

  const script = await loadMissionScript(dir, input.missionId)
  if (!script) throw new Error("failed to load mission script")

  for (const nodeId of topologicalNodeOrder(script.team)) {
    const sessionId = `ses_${nodeId}`
    bindSession(nodeId, sessionId)
    store.registerInnerNode({
      missionId: input.missionId,
      nodeId,
      sessionId,
      profile: nodeId === script.team.root ? "build" : "build",
    })
  }

  writeOrchestrationState(dir, initOrchestrationState(input.missionId, topologicalNodeOrder(script.team)))

  saveMissionScriptRecord(dir, {
    team: script.team,
    scriptPath: script.scriptPath,
    scriptHash: script.scriptHash,
  })
  if (script.plan) {
    saveOrchestrationPlanRecord(dir, script.plan)
  }

  return {
    dir,
    missionId: input.missionId,
    plugin,
    store,
    script,
    manifest: teamManifest(script.team),
    promptTexts,
    promptsByNode,
  }
}

export async function completeRunningNode(
  env: ReplayTestEnv,
  nodeId: string,
  opts?: { summary?: string },
) {
  const result = await orchestrationComplete({
    plugin: env.plugin,
    store: env.store,
    missionId: env.missionId,
    nodeId,
    skipAcceptanceSlice: true,
    completion: {
      summary: opts?.summary ?? `done ${nodeId}`,
      completed_at: new Date().toISOString(),
    },
  })
  if (result.status !== "ok") {
    throw new Error(`completeRunningNode(${nodeId}) failed: ${result.status}`)
  }
  await env.store.flushPendingDeliveries()
  return result
}

export function seedDoneNode(
  env: ReplayTestEnv,
  nodeId: string,
  opts?: { round?: number; summary?: string },
) {
  const now = new Date().toISOString()
  const state = readState(env)
  if (!state) throw new Error("missing orchestration state")
  state.nodes[nodeId] = {
    status: "done",
    completed_at: now,
    ...(opts?.round !== undefined && { round: opts.round }),
    completion: {
      summary: opts?.summary ?? `done ${nodeId}`,
      completed_at: now,
    },
  }
  writeOrchestrationState(env.dir, state)
}

export async function seedNodeBrief(
  env: ReplayTestEnv,
  nodeId: string,
  brief: { your_work: string[]; acceptance_slice: string[] },
) {
  await mergeAndSaveBrief(env.dir, env.missionId, nodeId, brief)
}

export async function seedNodeBriefs(
  env: ReplayTestEnv,
  briefs: Record<string, { your_work: string[]; acceptance_slice: string[] }>,
) {
  for (const [nodeId, brief] of Object.entries(briefs)) {
    await seedNodeBrief(env, nodeId, brief)
  }
}

export function seedDoneNodes(env: ReplayTestEnv, nodeIds: readonly string[]) {
  for (const nodeId of nodeIds) seedDoneNode(env, nodeId)
}

export async function completeNodes(env: ReplayTestEnv, nodeIds: readonly string[]) {
  for (const nodeId of nodeIds) {
    await completeRunningNode(env, nodeId)
    await Bun.sleep(100)
  }
}

export async function waitForAllPromptMarkers(
  env: ReplayTestEnv,
  markers: readonly string[],
  opts?: { label?: string },
) {
  for (const marker of markers) {
    await waitForPromptMarker(env, marker, { label: opts?.label ?? marker })
  }
}

export async function waitForCursorAtLeast(env: ReplayTestEnv, index: number, label?: string) {
  await waitUntil(() => (readState(env)?.cursor_step_index ?? 0) >= index, {
    label: label ?? `cursor >= ${index}`,
  })
}
export function readState(env: ReplayTestEnv) {
  return readOrchestrationState(env.dir, env.missionId)
}

export const SCRIPT = {
  linearThreeStep(missionId: string) {
    return `
export const team = {
  mission_id: "${missionId}",
  root: "n3",
  nodes: {
    n3: { parent: null, description: "root coordinator" },
    n2: { parent: "n3", description: "mid coordinator" },
    n1: { parent: "n2", description: "leaf worker" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.run("n1", { brief: { your_work: ["n1"], acceptance_slice: [] }, text: "marker:step0-n1" })
  await ctx.run("n2", {
    brief: { your_work: ["n2"], acceptance_slice: [] },
    text: "marker:step1-n2",
    dependsOn: [{ node: "n1", summary: true }],
  })
  await ctx.run("n3", {
    brief: { your_work: ["n3"], acceptance_slice: [] },
    text: "marker:step2-n3",
    dependsOn: [{ node: "n2", summary: true }],
  })
}
`
  },

  linearMultiRound(missionId: string) {
    return `
export const team = {
  mission_id: "${missionId}",
  root: "a",
  nodes: { a: { parent: null, description: "worker" } },
}
export default async function orchestrate(ctx) {
  await ctx.run("a", { brief: { your_work: ["wave1"], acceptance_slice: [] }, text: "marker:wave1" })
  await ctx.run("a", { brief: { your_work: ["wave2"], acceptance_slice: [] }, text: "marker:wave2" })
}
`
  },

  forkThenFinal(missionId: string) {
    return `
export const team = {
  mission_id: "${missionId}",
  root: "root",
  nodes: {
    root: { parent: null, description: "root" },
    a1: { parent: "root", description: "a1 leaf" },
    a2: { parent: "a1", description: "a2 leaf" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.fork([
    async () => {
      await ctx.run("a1", { brief: { your_work: ["a1"], acceptance_slice: [] }, text: "marker:fork-a1" })
      await ctx.run("a2", { brief: { your_work: ["a2"], acceptance_slice: [] }, text: "marker:fork-a2" })
    },
  ])
  await ctx.run("root", {
    brief: { your_work: ["final"], acceptance_slice: [] },
    text: "marker:final-root",
    dependsOn: [{ node: "a2", summary: true }],
  })
}
`
  },

  forkMultiRoundSameNode(missionId: string) {
    return `
export const team = {
  mission_id: "${missionId}",
  root: "a",
  nodes: { a: { parent: null, description: "worker" } },
}
export default async function orchestrate(ctx) {
  await ctx.fork([
    async () => {
      await ctx.run("a", { brief: { your_work: ["round1"], acceptance_slice: [] }, text: "marker:compound-r1" })
      await ctx.run("a", { brief: { your_work: ["round2"], acceptance_slice: [] }, text: "marker:compound-r2" })
    },
  ])
}
`
  },

  fanOutJoinRollup(missionId: string) {
    return `
export const team = {
  mission_id: "${missionId}",
  root: "root",
  nodes: {
    root: { parent: null, description: "root" },
    a: { parent: "root", description: "a" },
    b: { parent: "root", description: "b" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.fork([
    async () => {
      await ctx.run("a", {
        brief: { your_work: ["a"], acceptance_slice: [] },
        text: "marker:fanout-a",
      })
    },
    async () => {
      await ctx.run("b", {
        brief: { your_work: ["b"], acceptance_slice: [] },
        text: "marker:fanout-b",
      })
    },
  ])
  await ctx.run("root", {
    brief: { your_work: ["rollup"], acceptance_slice: [] },
    text: "marker:rollup-root",
    dependsOn: [{ node: "a", summary: true }, { node: "b", summary: true }],
  })
}
`
  },

  /** 组间并行：双轨 fork，轨内串行 fan-in 后 rollup 到协调节点，最后 root 汇总 */
  dualTrackForkFinal(missionId: string) {
    return `
export const team = {
  mission_id: "${missionId}",
  root: "root",
  nodes: {
    root: { parent: null, description: "root" },
    a: { parent: "root", description: "a coord" },
    b: { parent: "root", description: "b coord" },
    a1: { parent: "a", description: "a1" },
    a2: { parent: "a", description: "a2" },
    b1: { parent: "b", description: "b1" },
    b2: { parent: "b", description: "b2" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.fork([
    async () => {
      await ctx.run("a1", { brief: { your_work: ["a1"], acceptance_slice: [] }, text: "marker:trackA-a1" })
      await ctx.run("a2", { brief: { your_work: ["a2"], acceptance_slice: [] }, text: "marker:trackA-a2" })
      await ctx.run("a", {
        brief: { your_work: ["rollup a"], acceptance_slice: [] },
        text: "marker:trackA-rollup",
        dependsOn: [{ node: "a1", summary: true }, { node: "a2", summary: true }],
      })
    },
    async () => {
      await ctx.run("b1", { brief: { your_work: ["b1"], acceptance_slice: [] }, text: "marker:trackB-b1" })
      await ctx.run("b2", { brief: { your_work: ["b2"], acceptance_slice: [] }, text: "marker:trackB-b2" })
      await ctx.run("b", {
        brief: { your_work: ["rollup b"], acceptance_slice: [] },
        text: "marker:trackB-rollup",
        dependsOn: [{ node: "b1", summary: true }, { node: "b2", summary: true }],
      })
    },
  ])
  await ctx.run("root", {
    brief: { your_work: ["final"], acceptance_slice: [] },
    text: "marker:final-root",
    dependsOn: [{ node: "a", summary: true }, { node: "b", summary: true }],
  })
}
`
  },

  /** 组间 + 组内并行：双轨 fork，每轨内 fan-out 叶子后 join 再 rollup */
  dualTrackIntraFanOut(missionId: string) {
    return `
export const team = {
  mission_id: "${missionId}",
  root: "root",
  nodes: {
    root: { parent: null, description: "root" },
    a: { parent: "root", description: "a coord" },
    b: { parent: "root", description: "b coord" },
    a1: { parent: "a", description: "a1" },
    a2: { parent: "a", description: "a2" },
    b1: { parent: "b", description: "b1" },
    b2: { parent: "b", description: "b2" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.fork([
    async () => {
      await ctx.fork([
        async () => {
          await ctx.run("a1", {
            brief: { your_work: ["a1"], acceptance_slice: [] },
            text: "marker:trackA-a1",
          })
        },
        async () => {
          await ctx.run("a2", {
            brief: { your_work: ["a2"], acceptance_slice: [] },
            text: "marker:trackA-a2",
          })
        },
      ])
      await ctx.run("a", {
        brief: { your_work: ["rollup a"], acceptance_slice: [] },
        text: "marker:trackA-rollup",
        dependsOn: [{ node: "a1", summary: true }, { node: "a2", summary: true }],
      })
    },
    async () => {
      await ctx.fork([
        async () => {
          await ctx.run("b1", {
            brief: { your_work: ["b1"], acceptance_slice: [] },
            text: "marker:trackB-b1",
          })
        },
        async () => {
          await ctx.run("b2", {
            brief: { your_work: ["b2"], acceptance_slice: [] },
            text: "marker:trackB-b2",
          })
        },
      ])
      await ctx.run("b", {
        brief: { your_work: ["rollup b"], acceptance_slice: [] },
        text: "marker:trackB-rollup",
        dependsOn: [{ node: "b1", summary: true }, { node: "b2", summary: true }],
      })
    },
  ])
  await ctx.run("root", {
    brief: { your_work: ["final"], acceptance_slice: [] },
    text: "marker:final-root",
    dependsOn: [{ node: "a", summary: true }, { node: "b", summary: true }],
  })
}
`
  },

  /** 多层级：底层 fan-out → 逐层 rollup 到 root（4 层） */
  deepHierarchyFanOut(missionId: string) {
    return `
export const team = {
  mission_id: "${missionId}",
  root: "l4",
  nodes: {
    l4: { parent: null, description: "root" },
    l3: { parent: "l4", description: "l3 coord" },
    l2: { parent: "l3", description: "l2 coord" },
    l1a: { parent: "l2", description: "leaf a" },
    l1b: { parent: "l2", description: "leaf b" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.fork([
    async () => {
      await ctx.run("l1a", {
        brief: { your_work: ["l1a"], acceptance_slice: [] },
        text: "marker:leaf-l1a",
      })
    },
    async () => {
      await ctx.run("l1b", {
        brief: { your_work: ["l1b"], acceptance_slice: [] },
        text: "marker:leaf-l1b",
      })
    },
  ])
  await ctx.run("l2", {
    brief: { your_work: ["l2 rollup"], acceptance_slice: [] },
    text: "marker:rollup-l2",
    dependsOn: [{ node: "l1a", summary: true }, { node: "l1b", summary: true }],
  })
  await ctx.run("l3", {
    brief: { your_work: ["l3 rollup"], acceptance_slice: [] },
    text: "marker:rollup-l3",
    dependsOn: [{ node: "l2", summary: true }],
  })
  await ctx.run("l4", {
    brief: { your_work: ["l4 rollup"], acceptance_slice: [] },
    text: "marker:rollup-l4",
    dependsOn: [{ node: "l3", summary: true }],
  })
}
`
  },

  /** 组内并行 + compound 多轮：fork 单轨内 fan-out 后对协调节点两轮 run */
  intraFanOutCompoundMultiRound(missionId: string) {
    return `
export const team = {
  mission_id: "${missionId}",
  root: "coord",
  nodes: {
    coord: { parent: null, description: "coordinator" },
    x1: { parent: "coord", description: "x1" },
    x2: { parent: "coord", description: "x2" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.fork([
    async () => {
      await ctx.fork([
        async () => {
          await ctx.run("x1", {
            brief: { your_work: ["x1"], acceptance_slice: [] },
            text: "marker:fan-x1",
          })
        },
        async () => {
          await ctx.run("x2", {
            brief: { your_work: ["x2"], acceptance_slice: [] },
            text: "marker:fan-x2",
          })
        },
      ])
      await ctx.run("coord", {
        brief: { your_work: ["round1"], acceptance_slice: [] },
        text: "marker:coord-r1",
        dependsOn: [{ node: "x1", summary: true }, { node: "x2", summary: true }],
      })
      await ctx.run("coord", {
        brief: { your_work: ["round2"], acceptance_slice: [] },
        text: "marker:coord-r2",
      })
    },
  ])
}
`
  },

  /** 组间并行完成后，root 线性多轮 */
  dualTrackThenRootMultiRound(missionId: string) {
    return `
export const team = {
  mission_id: "${missionId}",
  root: "root",
  nodes: {
    root: { parent: null, description: "root" },
    a: { parent: "root", description: "a" },
    b: { parent: "root", description: "b" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.fork([
    async () => {
      await ctx.run("a", { brief: { your_work: ["a"], acceptance_slice: [] }, text: "marker:track-a" })
    },
    async () => {
      await ctx.run("b", { brief: { your_work: ["b"], acceptance_slice: [] }, text: "marker:track-b" })
    },
  ])
  await ctx.run("root", {
    brief: { your_work: ["root wave1"], acceptance_slice: [] },
    text: "marker:root-w1",
    dependsOn: [{ node: "a", summary: true }, { node: "b", summary: true }],
  })
  await ctx.run("root", {
    brief: { your_work: ["root wave2"], acceptance_slice: [] },
    text: "marker:root-w2",
  })
}
`
  },
}
