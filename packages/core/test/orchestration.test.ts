import { beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { formatNodeBriefBlock } from "../src/execution/brief.ts"
import { DEFAULT_GATEHOUSE_LOCALE } from "../src/locale.ts"
import { mergeAndSaveBrief } from "../src/orchestration/engine/events.ts"
import { deliverOrchestrationPrompt } from "../src/orchestration/engine/prompt.ts"
import { RegistryDatabase } from "../src/registry/db.ts"
import { RegistryStore } from "../src/registry/store.ts"
import { OUTER_ARCHITECT_ID } from "../src/registry/types.ts"
import type { GatehouseClient } from "../src/session/client.ts"
import {
  AWAITING_SKILL_DOMAINS_PHASE,
  ensureOrchestrationNodesInitialized,
  hasOrchestrationRuntime,
  initAwaitingSkillDomainsState,
  initOrchestrationState,
  markNodeRunning,
  mutateOrchestrationState,
  orchestrationNeedsResume,
  orchestrationStateNeedsNodeInit,
  readOrchestrationState,
  writeOrchestrationState,
} from "../src/orchestration/state/store.ts"
import { prepareOrchestrationRuntime } from "../src/orchestration/lifecycle/coordinator.ts"
import { createMissionContext } from "../src/orchestration/sandbox/host.ts"
import { saveMissionScriptRecord } from "../src/orchestration/lifecycle/coordinator.ts"
import { validateReworkRequest } from "../src/orchestration/state/rework.ts"
import { notifyOrchestrationWaiters } from "../src/orchestration/engine/wait.ts"
import type { MissionTeamSpec } from "../src/missions/manifest/types.ts"
import { loadMissionScript } from "../src/orchestration/script/load.ts"
import { startEphemeralServer, startPortalInternalEventCapture, withPortalEnv } from "./portal-test-server.ts"

const sampleTeam: MissionTeamSpec = {
  mission_id: "orch-m1",
  terminal: "terminal",
  nodes: {
    terminal: { description: "terminal" },
    a: { description: "worker a" },
    b: { description: "worker b" },
  },
}

describe("orchestration state", () => {
  test("initOrchestrationState starts all nodes pending", () => {
    const state = initOrchestrationState("m1", ["a", "b"])
    expect(state.nodes.a?.status).toBe("pending")
    expect(state.nodes.b?.status).toBe("pending")
  })

  test("markNodeRunning sets running and increments round after done", () => {
    const state = initOrchestrationState("m1", ["a"])
    markNodeRunning(state, "a")
    expect(state.nodes.a?.status).toBe("running")
    expect(state.nodes.a?.round).toBe(1)
    state.nodes.a = { status: "done", round: 1, completed_at: new Date().toISOString() }
    markNodeRunning(state, "a")
    expect(state.nodes.a?.status).toBe("running")
    expect(state.nodes.a?.round).toBe(2)
  })

  test("orchestrationNeedsResume when sandbox stopped and nodes incomplete", () => {
    const state = initOrchestrationState("m1", ["a", "b"])
    state.nodes.a = { status: "done" }
    expect(orchestrationNeedsResume(state, false)).toBe(true)
    expect(orchestrationNeedsResume(state, true)).toBe(false)
    state.nodes.b = { status: "done" }
    expect(orchestrationNeedsResume(state, false)).toBe(false)
  })

  test("ensureOrchestrationNodesInitialized seeds nodes after awaiting_skill_domains", () => {
    const awaiting = initAwaitingSkillDomainsState("m1", "abc123")
    expect(orchestrationStateNeedsNodeInit(awaiting, ["a", "b"])).toBe(true)

    const initialized = ensureOrchestrationNodesInitialized(awaiting, ["a", "b"])
    expect(initialized.nodes.a?.status).toBe("pending")
    expect(initialized.nodes.b?.status).toBe("pending")
    expect(initialized.phase).toBeUndefined()
    expect(initialized.sandbox?.script_hash).toBe("abc123")
  })

  test("ensureOrchestrationNodesInitialized preserves done nodes and fills missing", () => {
    const partial = initOrchestrationState("m1", ["a"])
    partial.nodes.a = { status: "done", completed_at: "2026-01-01T00:00:00.000Z" }
    const merged = ensureOrchestrationNodesInitialized(partial, ["a", "b"])
    expect(merged.nodes.a?.status).toBe("done")
    expect(merged.nodes.b?.status).toBe("pending")
  })

  test("mutateOrchestrationState preserves concurrent markNodeRunning", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-orch-race-"))
    try {
      writeOrchestrationState(dir, initOrchestrationState("race-m1", ["a", "b"]))
      await Promise.all([
        Promise.resolve().then(() =>
          mutateOrchestrationState(dir, "race-m1", (state) => markNodeRunning(state, "a")),
        ),
        Promise.resolve().then(() =>
          mutateOrchestrationState(dir, "race-m1", (state) => markNodeRunning(state, "b")),
        ),
      ])
      const loaded = readOrchestrationState(dir, "race-m1")
      expect(loaded?.nodes.a?.status).toBe("running")
      expect(loaded?.nodes.b?.status).toBe("running")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("prepareOrchestrationRuntime initializes nodes after awaiting_skill_domains", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-orch-prepare-"))
    try {
      writeOrchestrationState(dir, initAwaitingSkillDomainsState("orch-m1", "hash123"))
      const manifest = {
        mission_id: "orch-m1",
        status: "running" as const,
        terminal_node: "terminal",
        created_at: new Date().toISOString(),
        nodes: {
          terminal: { session_id: "ses_terminal"},
          a: { session_id: "ses_a"},
          b: { session_id: "ses_b"},
        },
      }
      const orchestrateSource = "export default async function orchestrate(ctx) {}"
      const prepared = await prepareOrchestrationRuntime(dir, manifest, {
        team: sampleTeam,
        scriptPath: ".gatehouse/missions/orch-m1/mission.script.ts",
        scriptHash: "hash123",
        scriptSource: orchestrateSource,
        orchestrateSource,
        plan: {
          schema_version: 1,
          mission_id: "orch-m1",
          plan_version: "test-plan",
          script_hash: "hash123",
          terminal_node: "terminal",
          steps: [],
          warnings: [],
        },
      })
      expect(prepared.status).toBe("prepared")
      if (prepared.status !== "prepared") return
      expect(prepared.state.nodes.terminal?.status).toBe("pending")
      expect(prepared.state.nodes.a?.status).toBe("pending")
      expect(prepared.state.nodes.b?.status).toBe("pending")
      expect(prepared.state.phase).not.toBe(AWAITING_SKILL_DOMAINS_PHASE)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("prompt(reply:true) marks parallel siblings without clobbering state", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-orch-parallel-prompt-"))
    try {
      writeOrchestrationState(dir, initOrchestrationState("parallel-m1", ["a", "b"]))
      const mockClient: GatehouseClient = {
        session: {
          async create() {
            return { id: "ses_unused" }
          },
          async promptAsync() {},
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
      const pluginInput = { directory: dir, client: mockClient } as unknown as PluginInput
      const store = await RegistryStore.create({ directory: dir, client: mockClient })
      store.registerInnerNode({ missionId: "parallel-m1", nodeId: "a", profile: "build", sessionId: "ses_a" })
      store.registerInnerNode({ missionId: "parallel-m1", nodeId: "b", profile: "build", sessionId: "ses_b" })

      const parallelTeam: MissionTeamSpec = {
        mission_id: "parallel-m1",
        terminal: "a",
        nodes: {
          a: { description: "worker a" },
          b: { description: "worker b" },
        },
      }
      const { engine } = createMissionContext({ plugin: pluginInput, store, team: parallelTeam })

      await mergeAndSaveBrief(dir, "parallel-m1", "a", { your_work: ["work a"], acceptance_slice: [] })
      await mergeAndSaveBrief(dir, "parallel-m1", "b", { your_work: ["work b"], acceptance_slice: [] })

      await Promise.all([
        engine.prompt("a", { text: "work a", reply: true }),
        engine.prompt("b", { text: "work b", reply: true }),
      ])

      const loaded = readOrchestrationState(dir, "parallel-m1")
      expect(loaded?.nodes.a?.status).toBe("running")
      expect(loaded?.nodes.b?.status).toBe("running")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("registry persists mission script and orchestration state", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-orch-db-"))
    try {
      saveMissionScriptRecord(dir, { team: sampleTeam, meta: { name: "test" } })
      expect(hasOrchestrationRuntime(dir, "orch-m1")).toBe(true)

      const state = initOrchestrationState("orch-m1", ["root", "a", "b"])
      writeOrchestrationState(dir, state)
      const loaded = readOrchestrationState(dir, "orch-m1")
      expect(loaded?.nodes.a?.status).toBe("pending")

      const registry = new RegistryDatabase(dir, { readonly: true })
      expect(registry.getMissionScript("orch-m1")?.team.terminal).toBe("terminal")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("orchestration rework validation", () => {
  test("rejects unknown blocker", () => {
    const state = initOrchestrationState("orch-m1", ["root", "a", "b"])
    state.nodes.a = { status: "running" }
    state.nodes.b = { status: "done" }
    const result = validateReworkRequest({
      team: sampleTeam,
      state,
      requesterNodeId: "a",
      blockedByNodeId: "missing",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("UNKNOWN_BLOCKER")
  })

  test("rejects rework when requester not running", () => {
    const blocked = initOrchestrationState("orch-m1", ["root", "a", "b"])
    blocked.nodes.a = { status: "blocked" }
    blocked.nodes.b = { status: "done" }
    const result = validateReworkRequest({
      team: sampleTeam,
      state: blocked,
      requesterNodeId: "a",
      blockedByNodeId: "b",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("NOT_RUNNING")
  })
})

describe("mission.script fixture", () => {
  test("loadMissionScript parses core-example-smoke-v1", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-orch-script-"))
    try {
      const missionId = "core-example-smoke-v1"
      const destRoot = path.join(dir, ".gatehouse/missions", missionId)
      await Bun.$`mkdir -p ${destRoot}`.quiet()
      const fixtureScript = path.join(import.meta.dir, "fixtures/core-example-smoke-v1/mission.script.ts")
      await Bun.write(path.join(destRoot, "mission.script.ts"), Bun.file(fixtureScript))

      const script = await loadMissionScript(dir, missionId)
      expect(script?.team.terminal).toBe("node-root")
      expect(script?.team.nodes["node-doc"]?.description).toBe("文档执行成员，负责 README 示例章节")
      expect(script?.meta?.name).toBe("core-example-smoke-v1")
      expect(script?.orchestrateSource).toContain("node-doc")
      expect(script?.scriptHash.length).toBe(64)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("orchestration prompt portal", () => {
  test("reply:true emits agent.chat from architect to inner node", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-orch-portal-chat-"))
    const token = "orch-test-token"
    const capture = await startPortalInternalEventCapture(token)
    try {
      await withPortalEnv(capture, token, async () => {
        const mockClient: GatehouseClient = {
          session: {
            async create() {
              return { id: "ses_unused" }
            },
            async promptAsync() {},
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
        const pluginInput = { directory: dir, client: mockClient } as unknown as PluginInput
        const store = await RegistryStore.create({ directory: dir, client: mockClient })
        store.register({
          agentId: OUTER_ARCHITECT_ID,
          scope: "outer",
          profile: "architect",
          sessionId: "ses_architect",
          displayName: "Architect",
        })
        store.registerInnerNode({
          missionId: "m1",
          nodeId: "node-doc",
          profile: "build",
          sessionId: "ses_doc",
        })
        const brief = await mergeAndSaveBrief(dir, "m1", "node-doc", { your_work: ["document"] })

        await deliverOrchestrationPrompt({
          plugin: pluginInput,
          store,
          missionId: "m1",
          nodeId: "node-doc",
          prompt: { text: "start documentation work", reply: true },
        })
        await capture.waitPosted()
        expect(capture.posted).toEqual({
          type: "agent.chat",
          fromSpawnId: "architect",
          toSpawnId: "node-doc",
          text: ["start documentation work", "", formatNodeBriefBlock(brief, DEFAULT_GATEHOUSE_LOCALE)].join("\n"),
        })
      })
    } finally {
      capture.server.stop()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("reply:false does not emit agent.chat", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-orch-portal-no-chat-"))
    const token = "orch-test-token"
    let posted = false
    let resolvePosted!: () => void
    const postedPromise = new Promise<void>((resolve) => {
      resolvePosted = resolve
    })
    const { server, port } = await startEphemeralServer(async (request) => {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/portal/api/internal/event") {
        return new Response("not found", { status: 404 })
      }
      posted = true
      resolvePosted()
      return Response.json({})
    })
    try {
      await withPortalEnv(port, token, async () => {
        const mockClient: GatehouseClient = {
          session: {
            async create() {
              return { id: "ses_unused" }
            },
            async promptAsync() {},
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
        const pluginInput = { directory: dir, client: mockClient } as unknown as PluginInput
        const store = await RegistryStore.create({ directory: dir, client: mockClient })
        store.registerInnerNode({
          missionId: "m1",
          nodeId: "node-doc",
          profile: "build",
          sessionId: "ses_doc",
        })
        await mergeAndSaveBrief(dir, "m1", "node-doc", { your_work: ["document"] })

        await deliverOrchestrationPrompt({
          plugin: pluginInput,
          store,
          missionId: "m1",
          nodeId: "node-doc",
          prompt: { text: "silent context injection", reply: false },
        })
        await Promise.race([
          postedPromise,
          Bun.sleep(200).then(() => undefined),
        ])
      })

      expect(posted).toBe(false)
    } finally {
      server.stop()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("orchestration wait", () => {
  beforeEach(async () => {
    const { clearMissionWaits } = await import("../src/orchestration/engine/wait.ts")
    for (const missionId of ["wait-m1", "race-m1"]) clearMissionWaits(missionId)
  })

  test("notifyOrchestrationWaiters resolves complete wait", async () => {
    const { waitForOrchestration } = await import("../src/orchestration/engine/wait.ts")
    const missionId = "wait-m1"
    const state = initOrchestrationState(missionId, ["a"])
    state.nodes.a = { status: "pending" }

    const waitPromise = waitForOrchestration(missionId, "a", "complete", { readState: () => state })

    state.nodes.a = { status: "done", completed_at: new Date().toISOString() }
    notifyOrchestrationWaiters(missionId, state)

    await waitPromise
  })

  test("readState poll resolves when notify happened before register", async () => {
    const { waitForOrchestration } = await import("../src/orchestration/engine/wait.ts")
    const missionId = "race-m1"
    const state = initOrchestrationState(missionId, ["a"])
    state.nodes.a = { status: "done", completed_at: new Date().toISOString() }

    notifyOrchestrationWaiters(missionId, state)

    const waitPromise = waitForOrchestration(missionId, "a", "complete", {
      readState: () => state,
    })
    await waitPromise
  })
})
