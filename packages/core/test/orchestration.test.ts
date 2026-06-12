import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { mergeAndSaveBrief } from "../src/orchestration/events.ts"
import { deliverOrchestrationPrompt } from "../src/orchestration/prompt.ts"
import { RegistryDatabase } from "../src/registry/db.ts"
import { RegistryStore } from "../src/registry/store.ts"
import { OUTER_ARCHITECT_ID } from "../src/registry/types.ts"
import type { GatehouseClient } from "../src/session/client.ts"
import {
  hasOrchestrationRuntime,
  initOrchestrationState,
  markNodeRunning,
  readOrchestrationState,
  writeOrchestrationState,
} from "../src/orchestration/state.ts"
import { saveMissionScriptRecord } from "../src/orchestration/context.ts"
import { validateReworkRequest } from "../src/orchestration/rework.ts"
import { notifyOrchestrationWaiters } from "../src/orchestration/wait.ts"
import type { TeamSpec } from "../src/tree/types.ts"
import { loadMissionScript } from "../src/orchestration/script-load.ts"
import { startPortalInternalEventCapture, withPortalEnv } from "./portal-test-server.ts"

const sampleTeam: TeamSpec = {
  mission_id: "orch-m1",
  root: "root",
  nodes: {
    root: { parent: null, description: "root" },
    a: { parent: "root", description: "worker a" },
    b: { parent: "a", description: "worker b" },
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
      expect(registry.getMissionScript("orch-m1")?.team.root).toBe("root")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("orchestration rework validation", () => {
  const state = initOrchestrationState("orch-m1", ["root", "a", "b"])
  state.nodes.a = { status: "running" }
  state.nodes.b = { status: "done" }

  test("allows parent reopening child", () => {
    const result = validateReworkRequest({
      team: sampleTeam,
      state,
      requesterNodeId: "a",
      blockedByNodeId: "b",
    })
    expect(result.ok).toBe(true)
  })

  test("rejects unknown blocker", () => {
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
      const destRoot = path.join(dir, ".gatehouse/trees", missionId)
      await Bun.$`mkdir -p ${destRoot}`.quiet()
      const fixtureScript = path.join(import.meta.dir, "fixtures/core-example-smoke-v1/mission.script.ts")
      await Bun.write(path.join(destRoot, "mission.script.ts"), Bun.file(fixtureScript))

      const script = await loadMissionScript(dir, missionId)
      expect(script?.team.root).toBe("node-root")
      expect(script?.team.nodes["node-doc"]?.parent).toBe("node-root")
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
    const capture = startPortalInternalEventCapture(token)
    try {
      await withPortalEnv(capture.port, token, async () => {
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
        await mergeAndSaveBrief(dir, "m1", "node-doc", { your_work: ["document"] })

        await deliverOrchestrationPrompt({
          plugin: pluginInput,
          store,
          missionId: "m1",
          nodeId: "node-doc",
          prompt: { text: "start documentation work", reply: true },
        })
        await capture.waitPosted()
      })

      expect(capture.posted).toEqual({
        type: "agent.chat",
        fromSpawnId: "architect",
        toSpawnId: "node-doc",
        text: "start documentation work",
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
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: async (request) => {
        if (request.method !== "POST" || new URL(request.url).pathname !== "/portal/api/internal/event") {
          return new Response("not found", { status: 404 })
        }
        posted = true
        resolvePosted()
        return Response.json({})
      },
    })
    try {
      await withPortalEnv(server.port!, token, async () => {
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
  test("notifyOrchestrationWaiters resolves complete wait", async () => {
    const { waitForOrchestration } = await import("../src/orchestration/wait.ts")
    const missionId = "wait-m1"
    const state = initOrchestrationState(missionId, ["a"])
    state.nodes.a = { status: "pending" }

    const waitPromise = waitForOrchestration(missionId, ["a"], "complete")

    state.nodes.a = { status: "done", completed_at: new Date().toISOString() }
    notifyOrchestrationWaiters(missionId, state)

    await waitPromise
  })
})
