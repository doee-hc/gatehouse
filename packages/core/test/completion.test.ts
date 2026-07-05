import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import {
  assertDependsOnDeliverableReady,
  formatDependsOnStructuredBlock,
  formatDependsOnSummaryBlock,
  parseStructuredOutputInput,
  validateStructuredOutputAgainstBrief,
  synthesizeTerminalDeliveryMarkdown,
} from "../src/orchestration/completion.ts"
import { orchestrationComplete } from "../src/orchestration/events.ts"
import { deliverOrchestrationPrompt } from "../src/orchestration/prompt.ts"
import { saveMissionScriptRecord } from "../src/orchestration/context.ts"
import { mergeAndSaveBrief } from "../src/orchestration/events.ts"
import {
  initOrchestrationState,
  markNodeRunning,
  readOrchestrationState,
  writeOrchestrationState,
} from "../src/orchestration/state.ts"
import { OUTER_ARCHITECT_ID } from "../src/registry/types.ts"
import { RegistryStore } from "../src/registry/store.ts"
import type { GatehouseClient } from "../src/session/client.ts"
import type { TeamSpec } from "../src/tree/types.ts"
import type { OrchestrationPlan } from "../src/orchestration/plan-types.ts"
import { startPortalInternalEventCapture, withPortalEnv } from "./portal-test-server.ts"

const team: TeamSpec = {
  mission_id: "m1",
  terminal: "terminal",
  nodes: {
    terminal: { description: "terminal" },
    leaf: { description: "leaf" },
  },
}

describe("node completion", () => {
  test("orchestrationComplete persists completion on node state", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-completion-"))
    try {
      saveMissionScriptRecord(dir, { team })
      const state = initOrchestrationState("m1", ["terminal", "leaf"])
      state.nodes.leaf = { status: "running", round: 1 }
      writeOrchestrationState(dir, state)

      const mockClient = {
        session: {
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
      const plugin = { directory: dir, client: mockClient } as unknown as PluginInput
      const store = await RegistryStore.create({ directory: dir, client: mockClient as never })

      await mergeAndSaveBrief(dir, "m1", "leaf", {
        your_work: ["update README"],
        acceptance_slice: ["README example section is complete"],
      })

      await orchestrationComplete({
        plugin,
        store,
        missionId: "m1",
        nodeId: "leaf",
        completion: {
          summary: "README section done; updated packages/core/README.md",
          completed_at: new Date().toISOString(),
          round: 1,
        },
      })

      const loaded = readOrchestrationState(dir, "m1")
      expect(loaded?.nodes.leaf?.status).toBe("done")
      expect(loaded?.nodes.leaf?.completion?.summary).toBe("README section done; updated packages/core/README.md")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("formatDependsOnSummaryBlock renders referenced completions", () => {
    const state = initOrchestrationState("m1", ["terminal", "leaf"])
    state.nodes.leaf = {
      status: "done",
      completion: {
        summary: "done work; wrote docs/x.md",
        completed_at: "2026-01-01T00:00:00.000Z",
      },
    }
    const block = formatDependsOnSummaryBlock("zh", state, ["leaf"])
    expect(block).toContain("上游节点交付")
    expect(block).toContain("leaf")
    expect(block).toContain("done work")
    expect(block).toContain("docs/x.md")
  })

  test("formatDependsOnStructuredBlock renders validated JSON", () => {
    const state = initOrchestrationState("m1", ["terminal", "leaf"])
    state.nodes.leaf = {
      status: "done",
      completion: {
        summary: "done work",
        structured_output: { files: ["src/a.ts"] },
        completed_at: "2026-01-01T00:00:00.000Z",
      },
    }
    const block = formatDependsOnStructuredBlock("en", state, ["leaf"])
    expect(block).toContain("Referenced structured outputs")
    expect(block).toContain("src/a.ts")
  })

  test("validateStructuredOutputAgainstBrief enforces schema", () => {
    const schema = {
      type: "object",
      required: ["count"],
      properties: { count: { type: "number" } },
    }
    expect(() => validateStructuredOutputAgainstBrief(undefined, { completion_schema: schema })).toThrow(
      /required/,
    )
    validateStructuredOutputAgainstBrief({ count: 1 }, { completion_schema: schema })
  })

  test("parseStructuredOutputInput accepts object or JSON string", () => {
    expect(parseStructuredOutputInput('{"a":1}')).toEqual({ a: 1 })
    expect(parseStructuredOutputInput({ a: 1 })).toEqual({ a: 1 })
  })

  test("assertDependsOnDeliverableReady rejects missing structured_output when schema set", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-deliverable-structured-"))
    try {
      saveMissionScriptRecord(dir, { team })
      const state = initOrchestrationState("m1", ["terminal", "leaf"])
      state.nodes.leaf = {
        status: "done",
        completion: { summary: "done", completed_at: "2026-01-01T00:00:00.000Z" },
      }
      await mergeAndSaveBrief(dir, "m1", "leaf", {
        your_work: ["emit structured result"],
        completion_schema: {
          type: "object",
          required: ["items"],
          properties: { items: { type: "array" } },
        },
      })
      let error: unknown
      try {
        await assertDependsOnDeliverableReady(dir, "m1", team, state, ["leaf"])
      } catch (caught) {
        error = caught
      }
      expect(error !== undefined).toBe(true)
      expect(String(error)).toMatch(/structured_output/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("orchestrationComplete rejects structured_output when schema validation fails", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-completion-structured-"))
    try {
      saveMissionScriptRecord(dir, { team })
      const state = initOrchestrationState("m1", ["terminal", "leaf"])
      state.nodes.leaf = { status: "running", round: 1 }
      writeOrchestrationState(dir, state)
      await mergeAndSaveBrief(dir, "m1", "leaf", {
        your_work: ["emit structured result"],
        completion_schema: {
          type: "object",
          required: ["items"],
          properties: { items: { type: "array" } },
        },
      })

      const mockClient = {
        session: {
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
      const plugin = { directory: dir, client: mockClient } as unknown as PluginInput
      const store = await RegistryStore.create({ directory: dir, client: mockClient as never })

      const result = await orchestrationComplete({
        plugin,
        store,
        missionId: "m1",
        nodeId: "leaf",
        completion: {
          summary: "done",
          structured_output: { wrong: true },
          completed_at: new Date().toISOString(),
        },
      })

      expect(result.status).toBe("structured_validation_failed")
      expect(readOrchestrationState(dir, "m1")?.nodes.leaf?.status).toBe("running")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("assertDependsOnDeliverableReady rejects missing completion", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-deliverable-missing-"))
    try {
      saveMissionScriptRecord(dir, { team })
      const state = initOrchestrationState("m1", ["terminal", "leaf"])
      state.nodes.leaf = { status: "done" }
      let error: unknown
      try {
        await assertDependsOnDeliverableReady(dir, "m1", team, state, ["leaf"])
      } catch (caught) {
        error = caught
      }
      expect(error !== undefined).toBe(true)
      expect(String(error)).toMatch(/completion/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("deliverOrchestrationPrompt appends dependsOn block", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-rollup-prompt-"))
    const token = "rollup-test-token"
    const capture = await startPortalInternalEventCapture(token)
    try {
      await withPortalEnv(capture.port, token, async () => {
        const state = initOrchestrationState("m1", ["terminal", "leaf"])
        state.nodes.leaf = {
          status: "done",
          completion: {
            summary: "leaf output",
            completed_at: new Date().toISOString(),
          },
        }
        markNodeRunning(state, "terminal")
        writeOrchestrationState(dir, state)
        await mergeAndSaveBrief(dir, "m1", "terminal", { your_work: ["rollup"] })

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
        const plugin = { directory: dir, client: mockClient } as unknown as PluginInput
        const store = await RegistryStore.create({ directory: dir, client: mockClient })
        store.register({
          agentId: OUTER_ARCHITECT_ID,
          scope: "outer",
          profile: "architect",
          sessionId: "ses_arch",
          displayName: "architect",
        })
        store.register({
          agentId: "inner:m1:terminal",
          scope: "inner",
          profile: "build",
          sessionId: "ses_terminal",
          displayName: "terminal",
          missionId: "m1",
          nodeId: "terminal",
          status: "active",
        })

        await deliverOrchestrationPrompt({
          plugin,
          store,
          missionId: "m1",
          nodeId: "terminal",
          team,
          prompt: {
            text: "[work order]",
            reply: true,
            dependsOn: [{ node: "leaf", deliverable: true }],
          },
        })
        await capture.waitPosted()

        const posted = capture.posted as { text?: string } | undefined
        expect(posted?.text).toContain("leaf output")
        expect(posted?.text).toContain("Referenced node completions")
      })
    } finally {
      capture.server.stop()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("synthesizeTerminalDeliveryMarkdown includes upstream completions", () => {
    const plan: OrchestrationPlan = {
      schema_version: 1,
      mission_id: "m1",
      plan_version: "v1",
      script_hash: "hash",
      warnings: [],
      steps: [
        { id: "step-0", op: "run", statement: 'await ctx.run("leaf", { text: "go" })', nodeId: "leaf" },
        {
          id: "step-1",
          op: "run",
          statement: 'await ctx.run("terminal", { text: "rollup", dependsOn: [{ node: "leaf", deliverable: true }] })',
          nodeId: "terminal",
        },
      ],
    }
    const state = initOrchestrationState("m1", ["terminal", "leaf"])
    state.nodes.terminal = {
      status: "done",
      completion: { summary: "rolled up", completed_at: "2026-01-01T00:00:00.000Z" },
    }
    state.nodes.leaf = {
      status: "done",
      completion: {
        summary: "leaf done; wrote a.md",
        completed_at: "2026-01-01T00:00:00.000Z",
      },
    }
    const md = synthesizeTerminalDeliveryMarkdown("zh", "m1", "terminal", state, team, plan)
    expect(md).toContain("rolled up")
    expect(md).toContain("leaf done")
    expect(md).toContain("a.md")
  })

  test("orchestrationComplete blocks when acceptance_slice path_exists is unmet", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-completion-precheck-"))
    try {
      saveMissionScriptRecord(dir, { team })
      const state = initOrchestrationState("m1", ["terminal", "leaf"])
      state.nodes.leaf = { status: "running", round: 1 }
      writeOrchestrationState(dir, state)
      await mergeAndSaveBrief(dir, "m1", "leaf", {
        your_work: ["write report"],
        acceptance_slice: ["path: docs/missing.md", "quality bar met"],
      })

      const mockClient = {
        session: {
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
      const plugin = { directory: dir, client: mockClient } as unknown as PluginInput
      const store = await RegistryStore.create({ directory: dir, client: mockClient as never })

      const result = await orchestrationComplete({
        plugin,
        store,
        missionId: "m1",
        nodeId: "leaf",
        completion: {
          summary: "done",
          completed_at: new Date().toISOString(),
        },
      })

      expect(result.status).toBe("acceptance_precheck_failed")
      if (result.status === "acceptance_precheck_failed") {
        expect(result.message).toContain("Acceptance slice precheck failed")
        expect(result.message).toContain("docs/missing.md")
      }
      expect(readOrchestrationState(dir, "m1")?.nodes.leaf?.status).toBe("running")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("orchestrationComplete passes when acceptance_slice path_exists is met", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-completion-precheck-ok-"))
    const rel = "docs/report.md"
    try {
      saveMissionScriptRecord(dir, { team })
      const state = initOrchestrationState("m1", ["terminal", "leaf"])
      state.nodes.leaf = { status: "running", round: 1 }
      writeOrchestrationState(dir, state)
      await mergeAndSaveBrief(dir, "m1", "leaf", {
        your_work: ["write report"],
        acceptance_slice: [`path: ${rel}`],
      })
      await Bun.write(path.join(dir, rel), "# report\n")

      const mockClient = {
        session: {
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
      const plugin = { directory: dir, client: mockClient } as unknown as PluginInput
      const store = await RegistryStore.create({ directory: dir, client: mockClient as never })

      const result = await orchestrationComplete({
        plugin,
        store,
        missionId: "m1",
        nodeId: "leaf",
        completion: {
          summary: "report written",
          completed_at: new Date().toISOString(),
        },
      })

      expect(result.status).toBe("ok")
      expect(readOrchestrationState(dir, "m1")?.nodes.leaf?.status).toBe("done")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
