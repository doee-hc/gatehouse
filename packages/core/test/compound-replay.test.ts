import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { createMissionContext } from "../src/orchestration/ctx-host.ts"
import { mergeAndSaveBrief } from "../src/orchestration/events.ts"
import { decideReplyPrompt, planStepKind } from "../src/orchestration/replay-policy.ts"
import { saveOrchestrationPlanRecord } from "../src/orchestration/plan-store.ts"
import type { OrchestrationPlan } from "../src/orchestration/plan-types.ts"
import { initOrchestrationState, readOrchestrationState, writeOrchestrationState } from "../src/orchestration/state.ts"
import { RegistryStore } from "../src/registry/store.ts"
import type { GatehouseClient } from "../src/session/client.ts"
import type { MissionTeamSpec } from "../src/missions/manifest/types.ts"

function samplePlan(steps: OrchestrationPlan["steps"]): OrchestrationPlan {
  return {
    schema_version: 1,
    mission_id: "compound-m1",
    plan_version: "test-plan-v1",
    script_hash: "test-hash",
    steps,
    warnings: [],
  }
}

describe("replay policy", () => {
  test("skips duplicate reply prompt for done nodes in compound steps", () => {
    const state = initOrchestrationState("m1", ["a"])
    state.nodes.a = { status: "done", completed_at: new Date().toISOString() }
    expect(
      decideReplyPrompt({
        state,
        nodeId: "a",
        hasPlanStep: true,
        stepIndex: 1,
        stepKind: "compound",
        reactivated: new Set(),
      }),
    ).toBe("skip")
    expect(
      decideReplyPrompt({
        state,
        nodeId: "a",
        hasPlanStep: true,
        stepIndex: 1,
        stepKind: "compound",
        reactivated: new Set(["a"]),
      }),
    ).toBe("deliver")
  })

  test("linear plan steps still deliver to done nodes", () => {
    const state = initOrchestrationState("m1", ["a"])
    state.nodes.a = { status: "done", completed_at: new Date().toISOString() }
    expect(
      decideReplyPrompt({
        state,
        nodeId: "a",
        hasPlanStep: true,
        stepIndex: 3,
        stepKind: "linear",
        reactivated: new Set(),
      }),
    ).toBe("deliver")
    expect(planStepKind("run")).toBe("linear")
    expect(planStepKind("parallel")).toBe("compound")
  })
})

describe("replay policy in mission context", () => {
  const team: MissionTeamSpec = {
    mission_id: "compound-m1",
    terminal: "a",
    nodes: {
      a: { description: "worker" },
    },
  }

  async function makeCtx(input: {
    planStep?: { id: string; index: number }
    compoundActive: boolean
  }) {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-compound-replay-"))
    writeOrchestrationState(dir, initOrchestrationState("compound-m1", ["a"]))

    if (input.compoundActive && input.planStep) {
      saveOrchestrationPlanRecord(
        dir,
        samplePlan([
          { id: "step-0", op: "run", statement: 'await ctx.run("a")' },
          {
            id: input.planStep.id,
            op: "parallel",
            statement: "await ctx.parallel([])",
          },
        ]),
      )
    }

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

    const { ctx, engine } = createMissionContext({
      plugin: pluginInput,
      store,
      team,
      ...(input.planStep && { planStep: () => input.planStep }),
    })

    return { dir, ctx, engine, promptTexts }
  }

  test("linear multi-round still prompts done nodes on a new plan step", async () => {
    const { dir, engine, promptTexts } = await makeCtx({
      planStep: { id: "step-3", index: 3 },
      compoundActive: false,
    })
    try {
      const state = initOrchestrationState("compound-m1", ["a"])
      state.nodes.a = { status: "done", completed_at: new Date().toISOString(), round: 1 }
      writeOrchestrationState(dir, state)

      await mergeAndSaveBrief(dir, "compound-m1", "a", { your_work: ["wave2"], acceptance_slice: ["done"] })
      await engine.prompt("a", { text: "wave2", reply: true })

      expect(promptTexts.some((text) => text.includes("wave2"))).toBe(true)
      const loaded = readOrchestrationState(dir, "compound-m1")
      expect(loaded?.nodes.a?.status).toBe("running")
      expect(loaded?.nodes.a?.round).toBe(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("compound replay skips duplicate prompt for done nodes", async () => {
    const { dir, engine, promptTexts } = await makeCtx({
      planStep: { id: "step-1", index: 1 },
      compoundActive: true,
    })
    try {
      const state = initOrchestrationState("compound-m1", ["a"])
      state.nodes.a = { status: "done", completed_at: new Date().toISOString() }
      writeOrchestrationState(dir, state)

      await engine.prompt("a", { text: "wave1", reply: true })

      expect(promptTexts).toEqual([])
      expect(readOrchestrationState(dir, "compound-m1")?.nodes.a?.status).toBe("done")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("compound multi-round prompts after revised setBrief", async () => {
    const { dir, engine, promptTexts } = await makeCtx({
      planStep: { id: "step-1", index: 1 },
      compoundActive: true,
    })
    try {
      const state = initOrchestrationState("compound-m1", ["a"])
      state.nodes.a = { status: "done", completed_at: new Date().toISOString(), round: 1 }
      writeOrchestrationState(dir, state)

      await engine.setBrief("a", { your_work: ["round 2"], acceptance_slice: ["done"] })
      expect(readOrchestrationState(dir, "compound-m1")?.compound_replay?.reactivated).toContain("a")

      await engine.prompt("a", { text: "wave2", reply: true })

      expect(promptTexts.some((text) => text.includes("wave2"))).toBe(true)
      expect(readOrchestrationState(dir, "compound-m1")?.compound_replay?.reactivated ?? []).not.toContain("a")
      expect(readOrchestrationState(dir, "compound-m1")?.nodes.a?.status).toBe("running")
      expect(readOrchestrationState(dir, "compound-m1")?.nodes.a?.round).toBe(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
