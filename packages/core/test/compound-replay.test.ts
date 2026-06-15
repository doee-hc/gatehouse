import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { createMissionContext } from "../src/orchestration/ctx-host.ts"
import {
  shouldSkipCompoundReplyPrompt,
  shouldSkipCompoundSetBriefDeliver,
} from "../src/orchestration/compound-replay.ts"
import { initOrchestrationState, readOrchestrationState, writeOrchestrationState } from "../src/orchestration/state.ts"
import { RegistryStore } from "../src/registry/store.ts"
import type { GatehouseClient } from "../src/session/client.ts"
import type { TeamSpec } from "../src/tree/types.ts"

describe("compound replay helpers", () => {
  test("skips duplicate reply prompt for done nodes without reactivation latch", () => {
    const state = initOrchestrationState("m1", ["a"])
    state.nodes.a = { status: "done", completed_at: new Date().toISOString() }
    expect(shouldSkipCompoundReplyPrompt(state, "a", new Set())).toBe(true)
    expect(shouldSkipCompoundReplyPrompt(state, "a", new Set(["a"]))).toBe(false)
  })

  test("skips unchanged setBrief deliver for done nodes", () => {
    const state = initOrchestrationState("m1", ["a"])
    state.nodes.a = { status: "done", completed_at: new Date().toISOString() }
    expect(shouldSkipCompoundSetBriefDeliver(state, "a", false)).toBe(true)
    expect(shouldSkipCompoundSetBriefDeliver(state, "a", true)).toBe(false)
  })
})

describe("compound replay in mission context", () => {
  const team: TeamSpec = {
    mission_id: "compound-m1",
    root: "a",
    nodes: {
      a: { parent: null, description: "worker" },
    },
  }

  async function makeCtx(input: {
    planStep?: { id: string; index: number }
    compoundActive: boolean
    latch?: Set<string>
  }) {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-compound-replay-"))
    writeOrchestrationState(dir, initOrchestrationState("compound-m1", ["a"]))

    const promptTexts: string[] = []
    const mockClient: GatehouseClient = {
      session: {
        async create() {
          return { id: "ses_a" }
        },
        async promptAsync(body: { body?: { parts?: { text?: string }[] } }) {
          promptTexts.push(body.body?.parts?.[0]?.text ?? "")
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
    const pluginInput = { directory: dir, client: mockClient } as unknown as PluginInput
    const store = await RegistryStore.create({ directory: dir, client: mockClient })
    store.registerInnerNode({ missionId: "compound-m1", nodeId: "a", profile: "build", sessionId: "ses_a" })

    const latch = input.latch ?? new Set<string>()
    const ctx = createMissionContext({
      plugin: pluginInput,
      store,
      team,
      ...(input.planStep && { planStep: () => input.planStep }),
      compoundReplay: () => ({
        active: input.compoundActive,
        latch,
      }),
    })

    return { dir, ctx, promptTexts, latch }
  }

  test("linear multi-round still prompts done nodes on a new plan step", async () => {
    const { dir, ctx, promptTexts } = await makeCtx({
      planStep: { id: "step-3", index: 3 },
      compoundActive: false,
    })
    try {
      const state = initOrchestrationState("compound-m1", ["a"])
      state.nodes.a = { status: "done", completed_at: new Date().toISOString(), round: 1 }
      writeOrchestrationState(dir, state)

      await ctx.prompt("a", { text: "wave2", reply: true })

      expect(promptTexts.some((text) => text.includes("wave2"))).toBe(true)
      const loaded = readOrchestrationState(dir, "compound-m1")
      expect(loaded?.nodes.a?.status).toBe("running")
      expect(loaded?.nodes.a?.round).toBe(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("compound replay skips duplicate prompt for done nodes", async () => {
    const { dir, ctx, promptTexts } = await makeCtx({
      planStep: { id: "step-1", index: 1 },
      compoundActive: true,
    })
    try {
      const state = initOrchestrationState("compound-m1", ["a"])
      state.nodes.a = { status: "done", completed_at: new Date().toISOString() }
      writeOrchestrationState(dir, state)

      await ctx.prompt("a", { text: "wave1", reply: true })

      expect(promptTexts).toEqual([])
      expect(readOrchestrationState(dir, "compound-m1")?.nodes.a?.status).toBe("done")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("compound multi-round prompts after revised setBrief", async () => {
    const latch = new Set<string>()
    const { dir, ctx, promptTexts, latch: sharedLatch } = await makeCtx({
      planStep: { id: "step-1", index: 1 },
      compoundActive: true,
      latch,
    })
    try {
      const state = initOrchestrationState("compound-m1", ["a"])
      state.nodes.a = { status: "done", completed_at: new Date().toISOString(), round: 1 }
      writeOrchestrationState(dir, state)

      await ctx.setBrief("a", { your_work: ["round 2"], acceptance_slice: ["done"] })
      expect(sharedLatch.has("a")).toBe(true)

      await ctx.prompt("a", { text: "wave2", reply: true })

      expect(promptTexts.some((text) => text.includes("wave2"))).toBe(true)
      expect(sharedLatch.has("a")).toBe(false)
      expect(readOrchestrationState(dir, "compound-m1")?.nodes.a?.status).toBe("running")
      expect(readOrchestrationState(dir, "compound-m1")?.nodes.a?.round).toBe(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
