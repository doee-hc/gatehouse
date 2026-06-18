import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import {
  assertDependsOnSummaryReady,
  formatRollupInjectionBlock,
  parseArtifactsInput,
  synthesizeRootDeliveryMarkdown,
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
import { startPortalInternalEventCapture, withPortalEnv } from "./portal-test-server.ts"

const team: TeamSpec = {
  mission_id: "m1",
  root: "root",
  nodes: {
    root: { parent: null, description: "root" },
    leaf: { parent: "root", description: "leaf" },
  },
}

describe("node completion", () => {
  test("parseArtifactsInput accepts JSON array", () => {
    const artifacts = parseArtifactsInput('[{"path":"docs/a.md","description":"readme"}]')
    expect(artifacts).toEqual([{ path: "docs/a.md", description: "readme" }])
  })

  test("orchestrationComplete persists completion on node state", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-completion-"))
    try {
      saveMissionScriptRecord(dir, { team })
      const state = initOrchestrationState("m1", ["root", "leaf"])
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
          summary: "README section done",
          artifacts: [{ path: "packages/core/README.md", description: "example mission section" }],
          completed_at: new Date().toISOString(),
          round: 1,
        },
      })

      const loaded = readOrchestrationState(dir, "m1")
      expect(loaded?.nodes.leaf?.status).toBe("done")
      expect(loaded?.nodes.leaf?.completion?.summary).toBe("README section done")
      expect(loaded?.nodes.leaf?.completion?.artifacts?.[0]?.path).toBe("packages/core/README.md")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("formatRollupInjectionBlock renders referenced completions", () => {
    const state = initOrchestrationState("m1", ["root", "leaf"])
    state.nodes.leaf = {
      status: "done",
      completion: {
        summary: "done work",
        artifacts: [{ path: "docs/x.md", description: "doc" }],
        completed_at: "2026-01-01T00:00:00.000Z",
      },
    }
    const block = formatRollupInjectionBlock("zh", state, ["leaf"])
    expect(block).toContain("下属节点交付")
    expect(block).toContain("leaf")
    expect(block).toContain("done work")
    expect(block).toContain("docs/x.md")
  })

  test("assertDependsOnSummaryReady rejects missing completion", () => {
    const state = initOrchestrationState("m1", ["root", "leaf"])
    state.nodes.leaf = { status: "done" }
    expect(() => assertDependsOnSummaryReady(team, state, ["leaf"])).toThrow(/completion/)
  })

  test("deliverOrchestrationPrompt appends dependsOn block", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-rollup-prompt-"))
    const token = "rollup-test-token"
    const capture = await startPortalInternalEventCapture(token)
    try {
      await withPortalEnv(capture.port, token, async () => {
        const state = initOrchestrationState("m1", ["root", "leaf"])
        state.nodes.leaf = {
          status: "done",
          completion: {
            summary: "leaf output",
            completed_at: new Date().toISOString(),
          },
        }
        markNodeRunning(state, "root")
        writeOrchestrationState(dir, state)
        await mergeAndSaveBrief(dir, "m1", "root", { your_work: ["rollup"] })

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
          agentId: "inner:m1:root",
          scope: "inner",
          profile: "build",
          sessionId: "ses_root",
          displayName: "root",
          missionId: "m1",
          nodeId: "root",
          status: "active",
        })

        await deliverOrchestrationPrompt({
          plugin,
          store,
          missionId: "m1",
          nodeId: "root",
          team,
          prompt: {
            text: "[work order]",
            reply: true,
            dependsOn: [{ node: "leaf", summary: true }],
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

  test("synthesizeRootDeliveryMarkdown includes child completions", () => {
    const state = initOrchestrationState("m1", ["root", "leaf"])
    state.nodes.root = {
      status: "done",
      completion: { summary: "rolled up", completed_at: "2026-01-01T00:00:00.000Z" },
    }
    state.nodes.leaf = {
      status: "done",
      completion: {
        summary: "leaf done",
        artifacts: [{ path: "a.md", description: "file" }],
        completed_at: "2026-01-01T00:00:00.000Z",
      },
    }
    const md = synthesizeRootDeliveryMarkdown("zh", "m1", "root", state, team)
    expect(md).toContain("rolled up")
    expect(md).toContain("leaf done")
    expect(md).toContain("a.md")
  })

  test("orchestrationComplete blocks when acceptance_slice path_exists is unmet", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-completion-precheck-"))
    try {
      saveMissionScriptRecord(dir, { team })
      const state = initOrchestrationState("m1", ["root", "leaf"])
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
      const state = initOrchestrationState("m1", ["root", "leaf"])
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
