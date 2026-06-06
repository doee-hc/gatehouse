#!/usr/bin/env bun
/**
 * Portal API ↔ UI status sync demo (no OpenCode).
 *
 * Simulates a running execution tree: outer roles + inner tree nodes go
 * idle → kickoff → parallel busy → research → wind-down → chat.
 *
 *   GATEHOUSE_PROJECT_DIR=/path/to/project bun script/status-sync-demo.ts
 *   GATEHOUSE_PORTAL_API=http://127.0.0.1:8797 GATEHOUSE_SNAPSHOT_POLL_MS=2000 bun script/portal-stack.ts ui
 */
import path from "node:path"
import { existsSync } from "node:fs"
import {
  computeOfficeLayoutSpec,
  readOfficeLayoutManifest,
  writeOfficeLayoutSpec,
} from "../../core/src/portal/office-layout.ts"
import { syncOfficeLayout } from "../../core/src/portal/office-layout-generate.ts"
import { portalOfficeDir } from "../../core/src/paths.ts"

const demoPort = Number(process.env.GATEHOUSE_PORTAL_DEMO_PORT ?? 8797)
const projectDir = path.resolve(process.env.GATEHOUSE_PROJECT_DIR ?? process.cwd())
const DEMO_MISSION = "demo-mission"

type AgentStatus = "idle" | "busy" | "research"

const DEMO_OUTER = [
  { spawn_id: "lead", session_id: "ses_demo_lead", profile: "lead", display_name: "Lead (demo)" },
  { spawn_id: "architect", session_id: "ses_demo_architect", profile: "architect", display_name: "Architect (demo)" },
  { spawn_id: "curator", session_id: "ses_demo_curator", profile: "curator", display_name: "Curator (demo)" },
  { spawn_id: "arbiter", session_id: "ses_demo_arbiter", profile: "arbiter", display_name: "Arbiter (demo)" },
] as const

const DEMO_TREE_NODES = [
  {
    node_id: "lead",
    session_id: "ses_demo_lead",
    parent: null as string | null,
    display_name: "执行组长",
    title: "coordinator",
  },
  {
    node_id: "worker-a",
    session_id: "ses_demo_worker_a",
    parent: "lead",
    display_name: "执行 A",
    skill_domain: "impl",
  },
  {
    node_id: "worker-b",
    session_id: "ses_demo_worker_b",
    parent: "lead",
    display_name: "执行 B",
    skill_domain: "impl",
  },
  {
    node_id: "worker-c",
    session_id: "ses_demo_worker_c",
    parent: "lead",
    display_name: "执行 C",
    skill_domain: "review",
  },
] as const

type DemoSpawnId = string

type DemoPhase = {
  label: string
  statuses: Record<DemoSpawnId, AgentStatus>
  sse?: unknown[]
}

const ALL_SPAWN_IDS = [
  ...DEMO_OUTER.map((agent) => agent.spawn_id),
  ...DEMO_TREE_NODES.map((node) => node.node_id),
]

function statusMap(partial: Record<string, AgentStatus>, fallback: AgentStatus = "idle") {
  const out = Object.fromEntries(ALL_SPAWN_IDS.map((id) => [id, fallback])) as Record<DemoSpawnId, AgentStatus>
  for (const id of ALL_SPAWN_IDS) {
    const status = partial[id]
    if (status) out[id] = status
  }
  return out
}

function sessionStatusRecord(statuses: Record<DemoSpawnId, AgentStatus>) {
  const out: Record<string, string> = {}
  for (const agent of DEMO_OUTER) {
    const status = statuses[agent.spawn_id] ?? "idle"
    out[agent.session_id] = status === "research" ? "busy" : status
  }
  for (const node of DEMO_TREE_NODES) {
    const status = statuses[node.node_id] ?? "idle"
    out[node.session_id] = status === "research" ? "busy" : status
  }
  return out
}

function sseSessionBusy(sessionId: string) {
  return {
    type: "session.status",
    properties: { sessionID: sessionId, status: { type: "busy" } },
  }
}

function sseSessionIdle(sessionId: string) {
  return { type: "session.idle", properties: { sessionID: sessionId } }
}

function sseTool(sessionId: string, tool: string) {
  return { type: "session.next.tool.called", properties: { sessionID: sessionId, tool } }
}

function sseBusySessions(sessionIds: string[]) {
  return sessionIds.map((sessionId) => sseSessionBusy(sessionId))
}

function sseIdleSessions(sessionIds: string[]) {
  return sessionIds.map((sessionId) => sseSessionIdle(sessionId))
}

const TREE_SESSIONS = DEMO_TREE_NODES.map((node) => node.session_id)
const WORKER_SESSIONS = DEMO_TREE_NODES.filter((node) => node.node_id !== "lead").map((node) => node.session_id)

const PHASES: DemoPhase[] = [
  {
    label: "1/8 tree idle — bootstrap 完成",
    statuses: statusMap({}),
    sse: [{ type: "ping" }],
  },
  {
    label: "2/8 kickoff — 婆盘 + 组长 busy",
    statuses: statusMap({ architect: "busy", lead: "busy" }),
    sse: sseBusySessions(["ses_demo_architect", "ses_demo_lead"]),
  },
  {
    label: "3/8 parallel — 全员执行 busy",
    statuses: statusMap({
      architect: "busy",
      lead: "busy",
      "worker-a": "busy",
      "worker-b": "busy",
      "worker-c": "busy",
    }),
    sse: [
      ...sseBusySessions(WORKER_SESSIONS),
      ...WORKER_SESSIONS.map((sessionId) => sseTool(sessionId, "edit")),
    ],
  },
  {
    label: "4/8 deep work — A 检索, 其余 busy",
    statuses: statusMap({
      architect: "busy",
      lead: "busy",
      "worker-a": "research",
      "worker-b": "busy",
      "worker-c": "busy",
    }),
    sse: [
      sseTool("ses_demo_worker_a", "rag_knowledge_search"),
      sseTool("ses_demo_worker_b", "edit"),
      sseTool("ses_demo_worker_c", "edit"),
    ],
  },
  {
    label: "5/8 sync — 组长发消息给 A",
    statuses: statusMap({
      architect: "busy",
      lead: "busy",
      "worker-a": "busy",
      "worker-b": "busy",
      "worker-c": "busy",
    }),
    sse: [
      {
        type: "agent.chat",
        fromSpawnId: "lead",
        toSpawnId: "worker-a",
        text: "请把检索结果整理进 brief 附录",
      },
    ],
  },
  {
    label: "6/8 wind-down — 执行树 idle",
    statuses: statusMap({ architect: "idle" }),
    sse: sseIdleSessions(TREE_SESSIONS),
  },
  {
    label: "7/8 outer idle — 横断验收",
    statuses: statusMap({}),
    sse: sseIdleSessions(DEMO_OUTER.map((agent) => agent.session_id)),
  },
  {
    label: "8/8 handoff — 横断 → 婆盘",
    statuses: statusMap({}),
    sse: [
      {
        type: "agent.chat",
        fromSpawnId: "lead",
        toSpawnId: "architect",
        text: "demo-mission 执行树一轮完成，请复盘",
      },
    ],
  },
]

const PHASE_MS = Number(process.env.GATEHOUSE_DEMO_PHASE_MS ?? 4000)

let phaseIndex = 0
let phaseStartedAt = Date.now()
const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>()

function cors(response: Response) {
  const headers = new Headers(response.headers)
  headers.set("Access-Control-Allow-Origin", "*")
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  headers.set("Access-Control-Allow-Headers", "Content-Type, x-opencode-directory")
  return new Response(response.body, { status: response.status, headers })
}

function json(data: unknown, status = 200) {
  return cors(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    }),
  )
}

function currentPhase() {
  return PHASES[phaseIndex]!
}

function formatPhaseStatuses(statuses: Record<DemoSpawnId, AgentStatus>) {
  const busy = ALL_SPAWN_IDS.filter((id) => statuses[id] === "busy" || statuses[id] === "research")
  return busy.length > 0 ? `busy: ${busy.join(", ")}` : "all idle"
}

function advancePhase() {
  phaseIndex = (phaseIndex + 1) % PHASES.length
  phaseStartedAt = Date.now()
  const phase = currentPhase()
  console.log(`[status-sync-demo] → ${phase.label}`)
  console.log(`[status-sync-demo]    ${formatPhaseStatuses(phase.statuses)}`)
  broadcastSse(phase.sse ?? [{ type: "ping" }])
}

function broadcastSse(events: unknown[]) {
  const encoder = new TextEncoder()
  for (const controller of sseClients) {
    for (const event of events) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
    }
  }
}

async function readOfficeLayoutMeta() {
  const layoutSpec = await computeOfficeLayoutSpec(projectDir)
  await writeOfficeLayoutSpec(projectDir, layoutSpec)
  const layoutManifest = await readOfficeLayoutManifest(projectDir)
  const officeLayoutReady =
    layoutManifest?.revision === layoutSpec.revision &&
    (await Bun.file(path.join(portalOfficeDir(projectDir), "scene-bg.png")).exists())
  return {
    revision: layoutSpec.revision,
    workstation_count: layoutSpec.workstation_count,
    ready: officeLayoutReady,
    bindings: layoutSpec.bindings,
    ...(layoutManifest?.warnings && layoutManifest.warnings.length > 0 && { warnings: layoutManifest.warnings }),
  }
}

function buildDemoSnapshot() {
  const phase = currentPhase()
  const tree = {
    mission_id: DEMO_MISSION,
    root_node: "lead",
    status: "running",
    nodes: DEMO_TREE_NODES.map((node) => {
      const entry: {
        node_id: string
        session_id: string
        parent: string | null
        display_name: string
        skill_domain?: string
      } = {
        node_id: node.node_id,
        session_id: node.session_id,
        parent: node.parent,
        display_name: node.display_name,
      }
      if ("skill_domain" in node) entry.skill_domain = node.skill_domain
      return entry
    }),
  }

  return {
    project_directory: projectDir,
    updated_at: new Date().toISOString(),
    active_mission_id: DEMO_MISSION,
    running_mission_ids: [DEMO_MISSION],
    missions: [
      {
        id: DEMO_MISSION,
        status: "running",
        objective: "执行树工作流 demo（bootstrap → 并行执行 → 收尾）",
      },
    ],
    tree,
    trees: [tree],
    agents: [
      ...DEMO_OUTER.map((agent) => ({
        agent_id: `demo:${agent.spawn_id}`,
        scope: "outer" as const,
        profile: agent.profile,
        display_name: agent.display_name,
        session_id: agent.session_id,
        mission_id: DEMO_MISSION,
        status: phase.statuses[agent.spawn_id],
        spawn_id: agent.spawn_id,
      })),
      ...DEMO_TREE_NODES.map((node) => ({
        agent_id: `demo:${DEMO_MISSION}:${node.node_id}`,
        scope: "inner" as const,
        profile: "inner",
        display_name: node.display_name,
        session_id: node.session_id,
        mission_id: DEMO_MISSION,
        node_id: node.node_id,
        status: phase.statuses[node.node_id],
        spawn_id: node.node_id,
      })),
    ],
    skills: [],
    session_status: sessionStatusRecord(phase.statuses),
    opencode_reachable: false,
    office_layout: undefined as Awaited<ReturnType<typeof readOfficeLayoutMeta>> | undefined,
  }
}

function officeAssetPath(name: string) {
  return path.join(portalOfficeDir(projectDir), name)
}

function serveOfficeFile(name: string, contentType: string) {
  const filePath = officeAssetPath(name)
  if (!existsSync(filePath)) return cors(new Response("office layout not generated", { status: 404 }))
  return cors(
    new Response(Bun.file(filePath), {
      headers: { "Content-Type": contentType, "Cache-Control": "no-store" },
    }),
  )
}

async function ensureOfficeLayout() {
  const sceneBg = officeAssetPath("scene-bg.png")
  if (existsSync(sceneBg)) return
  console.warn(
    `[status-sync-demo] office layout missing — run: GATEHOUSE_PROJECT_DIR=${projectDir} bun run import:office-layout`,
  )
  await syncOfficeLayout(projectDir).catch(() => undefined)
}

function startPhaseTimer() {
  setInterval(() => advancePhase(), PHASE_MS)
}

function startDemoEvents() {
  const encoder = new TextEncoder()
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
  return cors(
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller
          sseClients.add(controller)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "ping" })}\n\n`))
          for (const event of currentPhase().sse ?? []) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          }
        },
        cancel() {
          if (!streamController) return
          sseClients.delete(streamController)
          streamController = undefined
        },
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      },
    ),
  )
}

await ensureOfficeLayout()

const server = Bun.serve({
  port: demoPort,
  hostname: "127.0.0.1",
  fetch: async (request) => {
    const url = new URL(request.url)
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }))

    if (url.pathname === "/portal/api/health") {
      return json({
        ok: true,
        demo: true,
        project_directory: projectDir,
        default_project_directory: projectDir,
        phase: currentPhase().label,
        agent_statuses: currentPhase().statuses,
        phase_ms: PHASE_MS,
        phase_elapsed_ms: Date.now() - phaseStartedAt,
      })
    }

    if (url.pathname === "/portal/api/snapshot") {
      const snapshot = buildDemoSnapshot()
      snapshot.office_layout = await readOfficeLayoutMeta()
      return json(snapshot)
    }

    if (url.pathname === "/portal/api/blog") {
      return json({ project_directory: projectDir, updated_at: new Date().toISOString(), groups: [] })
    }

    if (url.pathname === "/portal/api/office/manifest.json") {
      const manifest = await readOfficeLayoutManifest(projectDir)
      if (!manifest) return cors(new Response("office layout unavailable", { status: 404 }))
      return json(manifest)
    }

    if (url.pathname === "/portal/api/office/map.json") {
      return serveOfficeFile("map.json", "application/json; charset=utf-8")
    }

    if (url.pathname === "/portal/api/office/scene-bg.png") {
      return serveOfficeFile("scene-bg.png", "image/png")
    }

    if (url.pathname === "/portal/api/office/collision-tile.png") {
      return serveOfficeFile("collision-tile.png", "image/png")
    }

    if (url.pathname.startsWith("/portal/api/office/assets/objects/")) {
      const name = decodeURIComponent(url.pathname.slice("/portal/api/office/assets/objects/".length))
      if (!name || name.includes("..") || name.includes("/")) {
        return cors(new Response("invalid object path", { status: 400 }))
      }
      return serveOfficeFile(path.join("assets", "objects", name), "image/png")
    }

    if (url.pathname === "/portal/events") return startDemoEvents()

    if (url.pathname === "/portal/api/event" && request.method === "POST") {
      const event = await request.json()
      broadcastSse([event])
      return json({ ok: true })
    }

    return cors(new Response("not found", { status: 404 }))
  },
})

console.log(`[status-sync-demo] → ${currentPhase().label}`)
console.log(`[status-sync-demo]    ${formatPhaseStatuses(currentPhase().statuses)}`)
broadcastSse(currentPhase().sse ?? [{ type: "ping" }])
startPhaseTimer()

const pollMs = process.env.GATEHOUSE_SNAPSHOT_POLL_MS ?? "2000"

console.log("")
console.log("[status-sync-demo] 执行树 + 外层角色 · Portal API ↔ UI demo")
console.log(`  API       http://127.0.0.1:${demoPort}/portal/api/snapshot`)
console.log(`  outer     ${DEMO_OUTER.map((agent) => agent.spawn_id).join(", ")}`)
console.log(`  tree      ${DEMO_TREE_NODES.map((node) => node.node_id).join(" → ")}`)
console.log(`  phase     ${PHASE_MS}ms × ${PHASES.length} steps`)
console.log("")
console.log("Start UI:")
console.log(
  `  GATEHOUSE_PORTAL_API=http://127.0.0.1:${demoPort} GATEHOUSE_PROJECT_DIR=${projectDir} GATEHOUSE_SNAPSHOT_POLL_MS=${pollMs} bun script/portal-stack.ts ui`,
)
console.log("")
console.log("Watch cubicles: inner agents sit at bound desks when busy, wander when idle.")
console.log("")

process.on("SIGINT", () => {
  server.stop()
  process.exit(0)
})

await Bun.sleep(Number.POSITIVE_INFINITY)
