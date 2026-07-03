import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { RegistryStore } from "../src/registry/store.ts"
import { innerAgentId } from "../src/registry/types.ts"
import type { GatehouseClient } from "../src/session/client.ts"
import {
  clampSnapshotLines,
  collectSessionActivityLines,
  tailSessionSnapshotLines,
} from "../src/session/snapshot.ts"
import { seedActiveMissionRegistry } from "./copy-example-mission.ts"
import { resetSessionSnapshotPollGuardForTests } from "../src/tools/session-snapshot-poll-guard.ts"
import { sessionSnapshotTool } from "../src/tools/session-snapshot.ts"

function mockToolContext(directory: string, sessionID: string, agent: string): ToolContext {
  return {
    sessionID,
    messageID: "test-message",
    agent,
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata() {},
    ask() {
      throw new Error("ask not implemented in mock")
    },
  }
}

function toolOutput(result: Awaited<ReturnType<ReturnType<typeof sessionSnapshotTool>["execute"]>>) {
  return typeof result === "string" ? result : result.output
}

function parseEnvelope(output: string) {
  return JSON.parse(output) as {
    ok: boolean
    data?: {
      tail: string[]
      session_status: string
      guidance: string
    }
    error?: { code: string }
  }
}

describe("session snapshot", () => {
  test("clampSnapshotLines enforces max 50", () => {
    expect(clampSnapshotLines(undefined)).toBe(20)
    expect(clampSnapshotLines(12)).toBe(12)
    expect(clampSnapshotLines(200)).toBe(50)
  })

  test("tailSessionSnapshotLines returns last activity lines", () => {
    const messages = [
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "line one\nline two" }, { type: "tool", tool: "read", state: { status: "running" } }],
      },
      {
        info: { role: "user" },
        parts: [{ type: "text", text: "ping" }],
      },
    ]
    expect(collectSessionActivityLines(messages)).toEqual([
      "assistant: line one",
      "assistant: line two",
      "assistant: [tool read running]",
      "user: ping",
    ])
    expect(tailSessionSnapshotLines(messages, 2)).toEqual([
      "assistant: [tool read running]",
      "user: ping",
    ])
  })

  test("gatehouse_session_snapshot resolves node and reports busy tail", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-snapshot-"))
    try {
      const mockMessages = [
        {
          info: { role: "assistant" },
          parts: [
            { type: "text", text: "working on delivery" },
            { type: "tool", tool: "write", state: { status: "running" } },
          ],
        },
      ]
      const mockClient: GatehouseClient = {
        session: {
          async create() {
            return { id: "unused" }
          },
          async promptAsync() {},
          async messages() {
            return { data: mockMessages }
          },
          async get() {
            return { data: {} }
          },
          async status() {
            return { data: { "ses_worker": { type: "busy" } } }
          },
        },
      }

      const store = await RegistryStore.create({ directory: dir, client: mockClient })
      store.registerOuterSession({
        profile: "architect",
        sessionId: "ses_architect",
        projectRootSessionId: "ses_lead",
      })
      store.registerInnerNode({
        missionId: "m1",
        nodeId: "node-root",
        profile: "build",
        sessionId: "ses_worker",
      })
      seedActiveMissionRegistry(dir, "m1")

      const snapshot = sessionSnapshotTool({ directory: dir, client: mockClient } as unknown as PluginInput)
      const output = toolOutput(
        await snapshot.execute(
          { recipient: "node-root", lines: 10 },
          mockToolContext(dir, "ses_architect", "architect"),
        ),
      )
      const envelope = parseEnvelope(output)
      expect(envelope.ok).toBe(true)
      expect(envelope.data?.session_status).toBe("busy")
      expect(Boolean(envelope.data?.guidance)).toBe(true)
      expect(envelope.data?.tail).toContain("assistant: working on delivery")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("allows arbiter snapshot of architect session", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-snapshot-arbiter-"))
    try {
      const mockMessages = [
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "planning next mission" }],
        },
      ]
      const mockClient: GatehouseClient = {
        session: {
          async create() {
            return { id: "ses_arbiter" }
          },
          async promptAsync() {},
          async messages() {
            return { data: mockMessages }
          },
          async get() {
            return { data: {} }
          },
          async status() {
            return { data: { ses_architect: { type: "idle" } } }
          },
        },
      }

      const store = await RegistryStore.create({ directory: dir, client: mockClient })
      store.registerOuterSession({
        profile: "architect",
        sessionId: "ses_architect",
        projectRootSessionId: "ses_lead",
      })
      await store.ensureArbiterSession("ses_lead")

      const snapshot = sessionSnapshotTool({ directory: dir, client: mockClient } as unknown as PluginInput)
      const output = toolOutput(
        await snapshot.execute(
          { recipient: "architect" },
          mockToolContext(dir, "ses_arbiter", "arbiter"),
        ),
      )
      const envelope = parseEnvelope(output)
      expect(envelope.ok).toBe(true)
      expect(envelope.data?.tail).toContain("assistant: planning next mission")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("blocks consecutive snapshot polling of the same recipient after 3 calls", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-snapshot-poll-"))
    try {
      resetSessionSnapshotPollGuardForTests()
      const mockMessages = [
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "still working" }],
        },
      ]
      const mockClient: GatehouseClient = {
        session: {
          async create() {
            return { id: "unused" }
          },
          async promptAsync() {},
          async messages() {
            return { data: mockMessages }
          },
          async get() {
            return { data: {} }
          },
          async status() {
            return { data: { ses_worker: { type: "busy" } } }
          },
        },
      }

      const store = await RegistryStore.create({ directory: dir, client: mockClient })
      store.registerOuterSession({
        profile: "architect",
        sessionId: "ses_architect",
        projectRootSessionId: "ses_lead",
      })
      store.registerInnerNode({
        missionId: "m1",
        nodeId: "node-root",
        profile: "build",
        sessionId: "ses_worker",
      })
      seedActiveMissionRegistry(dir, "m1")

      const snapshot = sessionSnapshotTool({ directory: dir, client: mockClient } as unknown as PluginInput)
      const context = mockToolContext(dir, "ses_architect", "architect")
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const output = toolOutput(await snapshot.execute({ recipient: "node-root" }, context))
        const envelope = parseEnvelope(output)
        expect(envelope.ok).toBe(true)
      }

      const blocked = toolOutput(await snapshot.execute({ recipient: "node-root" }, context))
      const envelope = parseEnvelope(blocked)
      expect(envelope.ok).toBe(false)
      expect(envelope.error?.code).toBe("SNAPSHOT_POLL_LIMIT")
    } finally {
      resetSessionSnapshotPollGuardForTests()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("allows snapshotting different recipients in the same turn", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-snapshot-poll-multi-"))
    try {
      resetSessionSnapshotPollGuardForTests()
      const mockMessages = [
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "status" }],
        },
      ]
      const mockClient: GatehouseClient = {
        session: {
          async create() {
            return { id: "unused" }
          },
          async promptAsync() {},
          async messages() {
            return { data: mockMessages }
          },
          async get() {
            return { data: {} }
          },
          async status() {
            return {
              data: {
                ses_worker_a: { type: "idle" },
                ses_worker_b: { type: "idle" },
                ses_worker_c: { type: "idle" },
                ses_worker_d: { type: "idle" },
              },
            }
          },
        },
      }

      const store = await RegistryStore.create({ directory: dir, client: mockClient })
      store.registerOuterSession({
        profile: "architect",
        sessionId: "ses_architect",
        projectRootSessionId: "ses_lead",
      })
      for (const [nodeId, sessionId] of [
        ["node-a", "ses_worker_a"],
        ["node-b", "ses_worker_b"],
        ["node-c", "ses_worker_c"],
        ["node-d", "ses_worker_d"],
      ] as const) {
        store.registerInnerNode({
          missionId: "m1",
          nodeId,
          profile: "build",
          sessionId,
        })
      }
      seedActiveMissionRegistry(dir, "m1")

      const snapshot = sessionSnapshotTool({ directory: dir, client: mockClient } as unknown as PluginInput)
      const context = mockToolContext(dir, "ses_architect", "architect")
      for (const nodeId of ["node-a", "node-b", "node-c", "node-d"]) {
        const output = toolOutput(await snapshot.execute({ recipient: nodeId }, context))
        const envelope = parseEnvelope(output)
        expect(envelope.ok).toBe(true)
      }
    } finally {
      resetSessionSnapshotPollGuardForTests()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("resets poll guard on a new assistant turn", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-snapshot-poll-turn-"))
    try {
      resetSessionSnapshotPollGuardForTests()
      const mockMessages = [
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "status" }],
        },
      ]
      const mockClient: GatehouseClient = {
        session: {
          async create() {
            return { id: "unused" }
          },
          async promptAsync() {},
          async messages() {
            return { data: mockMessages }
          },
          async get() {
            return { data: {} }
          },
          async status() {
            return { data: { ses_worker: { type: "busy" } } }
          },
        },
      }

      const store = await RegistryStore.create({ directory: dir, client: mockClient })
      store.registerOuterSession({
        profile: "architect",
        sessionId: "ses_architect",
        projectRootSessionId: "ses_lead",
      })
      store.registerInnerNode({
        missionId: "m1",
        nodeId: "node-root",
        profile: "build",
        sessionId: "ses_worker",
      })
      seedActiveMissionRegistry(dir, "m1")

      const snapshot = sessionSnapshotTool({ directory: dir, client: mockClient } as unknown as PluginInput)
      const firstTurn = mockToolContext(dir, "ses_architect", "architect")
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const output = toolOutput(await snapshot.execute({ recipient: "node-root" }, firstTurn))
        expect(parseEnvelope(output).ok).toBe(true)
      }

      const secondTurn = { ...firstTurn, messageID: "next-turn-message" }
      const output = toolOutput(await snapshot.execute({ recipient: "node-root" }, secondTurn))
      expect(parseEnvelope(output).ok).toBe(true)
    } finally {
      resetSessionSnapshotPollGuardForTests()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("forbids inner terminal node snapshot of peer node", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-snapshot-inner-deny-"))
    try {
      const mockClient: GatehouseClient = {
        session: {
          async create() {
            return { id: "unused" }
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

      const store = await RegistryStore.create({ directory: dir, client: mockClient })
      store.registerInnerNode({
        missionId: "m1",
        nodeId: "node-root",
        profile: "build",
        sessionId: "ses_root",
      })
      store.registerInnerNode({
        missionId: "m1",
        nodeId: "node-doc",
        profile: "build",
        sessionId: "ses_worker",
      })
      seedActiveMissionRegistry(dir, "m1")

      const snapshot = sessionSnapshotTool({ directory: dir, client: mockClient } as unknown as PluginInput)
      const output = toolOutput(
        await snapshot.execute(
          { recipient: "node-doc" },
          mockToolContext(dir, "ses_root", "build"),
        ),
      )
      const envelope = parseEnvelope(output)
      expect(envelope.ok).toBe(false)
      expect(envelope.error?.code).toBe("SNAPSHOT_FORBIDDEN")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("forbids hengduan snapshot of inner leaf node", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-snapshot-deny-"))
    try {
      const mockClient: GatehouseClient = {
        session: {
          async create() {
            return { id: "unused" }
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

      const store = await RegistryStore.create({ directory: dir, client: mockClient })
      store.registerOuterSession({
        profile: "lead",
        sessionId: "ses_lead",
        projectRootSessionId: "ses_lead",
      })
      store.registerInnerNode({
        missionId: "m1",
        nodeId: "node-root",
        profile: "build",
        sessionId: "ses_root",
      })
      store.registerInnerNode({
        missionId: "m1",
        nodeId: "node-doc",
        profile: "build",
        sessionId: "ses_worker",
      })
      seedActiveMissionRegistry(dir, "m1")

      const snapshot = sessionSnapshotTool({ directory: dir, client: mockClient } as unknown as PluginInput)
      const output = toolOutput(
        await snapshot.execute(
          { recipient: innerAgentId("m1", "node-doc") },
          mockToolContext(dir, "ses_lead", "lead"),
        ),
      )
      const envelope = parseEnvelope(output)
      expect(envelope.ok).toBe(false)
      expect(envelope.error?.code).toBe("SNAPSHOT_FORBIDDEN")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
