import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { getRegistryStore } from "../src/registry/context.ts"
import { OUTER_ARCHITECT_ID } from "../src/registry/types.ts"
import { initOrchestrationState, writeOrchestrationState } from "../src/orchestration/state.ts"
import { startSandboxOrchestration, stopSandboxOrchestration } from "../src/orchestration/sandbox-runtime.ts"
import { parseMissionScriptSource } from "../src/orchestration/script-parse.ts"
import { notifyArchitectOrchestrationFailure } from "../src/orchestration/notify.ts"
import { orchestrationCanRetry } from "../src/orchestration/retry.ts"
import { topologicalNodeOrder } from "../src/tree/parse.ts"
import { writeManifest } from "../src/tree/store.ts"
import { bootstrapTreeTool } from "../src/tools/bootstrap.ts"
import { writeMissionsDocument } from "../src/missions/store.ts"
import { seedActiveMissionRegistry } from "./copy-example-mission.ts"

const brokenScript = `
export const team = {
  mission_id: "orch-fail-m1",
  root: "leaf",
  nodes: { leaf: { parent: null, description: "leaf" } },
}
export default async function orchestrate(ctx) {
  await ctx.setBrief("leaf", { your_work: ["work"], not_your_job: [], acceptance_slice: ["done"] })
  await ctx.prompt("leaf", {
    text: ctx.template.workOrder("leaf", {
      note: "bad gatehouse_send_message(recipient="ai-writer", message="done")",
    }),
    reply: true,
  })
  await ctx.waitFor("leaf", "complete")
}
`

function mockToolContext(directory: string, agent = "architect", sessionID = "ses_architect"): ToolContext {
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

async function seedRunningMission(dir: string, missionId: string) {
  await writeMissionsDocument(dir, {
    schema_version: 3,
    missions: [
      {
        id: missionId,
        status: "running",
        priority: "P1",
        objective: "test mission",
        done_when: ["done"],
        must_not: [],
        started_at: new Date().toISOString(),
      },
    ],
  })
  seedActiveMissionRegistry(dir, missionId)
}

function toolOutput(result: Awaited<ReturnType<ReturnType<typeof bootstrapTreeTool>["execute"]>>) {
  return typeof result === "string" ? result : result.output
}

describe("orchestration failure feedback", () => {
  test("startSandboxOrchestration returns error for invalid orchestrate syntax", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-orch-fail-"))
    try {
      const missionId = "orch-fail-m1"
      const parsed = parseMissionScriptSource(brokenScript, missionId)
      const script = {
        team: parsed.team,
        orchestrateSource: parsed.orchestrateSource!,
        scriptSource: brokenScript,
        scriptHash: parsed.scriptHash,
        scriptPath: path.join(dir, ".gatehouse/trees", missionId, "mission.script.ts"),
      }
      writeOrchestrationState(dir, initOrchestrationState(missionId, topologicalNodeOrder(script.team)))

      const pluginInput = {
        directory: dir,
        client: { session: { async promptAsync() {}, async status() { return { data: {} } } } },
      } as unknown as PluginInput
      const store = await getRegistryStore(pluginInput)
      store.registerInnerNode({ missionId, nodeId: "leaf", sessionId: "ses_leaf", profile: "build-root" })

      const started = await startSandboxOrchestration({ plugin: pluginInput, store, script })
      expect(started.status).toBe("error")
      if (started.status !== "error") return
      expect(started.message).toContain("Unexpected identifier")
    } finally {
      stopSandboxOrchestration("orch-fail-m1")
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("notifyArchitectOrchestrationFailure delivers to architect session", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-orch-notify-"))
    try {
      const pluginInput = {
        directory: dir,
        client: { session: { async promptAsync() {}, async status() { return { data: {} } } } },
      } as unknown as PluginInput
      const store = await getRegistryStore(pluginInput)
      store.register({
        agentId: OUTER_ARCHITECT_ID,
        scope: "outer",
        profile: "architect",
        sessionId: "ses_architect",
        displayName: "Architect",
      })

      const delivered: string[] = []
      store.deliverSystemMessage = async (_agent, content) => {
        delivered.push(content)
        return { status: "sent" as const }
      }

      const result = await notifyArchitectOrchestrationFailure(store, dir, {
        missionId: "orch-fail-m1",
        error: "Unexpected identifier 'ai'",
      })
      expect(result.delivery).toBe("sent")
      expect(delivered[0]).toContain("Unexpected identifier 'ai'")
      expect(delivered[0]).toContain("gatehouse_bootstrap_tree")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("architect can restart orchestration via bootstrap_tree after fix", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-orch-retry-"))
    try {
      const missionId = "orch-retry-m1"
      const fixture = path.join(import.meta.dir, "fixtures/core-example-smoke-v1/mission.script.ts")
      const dest = path.join(dir, ".gatehouse/trees", missionId)
      await Bun.$`mkdir -p ${dest}`.quiet()
      const fixedSource = (await Bun.file(fixture).text()).replaceAll("core-example-smoke-v1", missionId)
      await Bun.write(path.join(dest, "mission.script.ts"), fixedSource)
      await seedRunningMission(dir, missionId)

      const promptTexts: string[] = []
      const mockClient = {
        session: {
          async create() {
            return { id: "ses_leaf" }
          },
          async promptAsync(input: { body?: { parts?: { text?: string }[] } }) {
            promptTexts.push(input.body?.parts?.[0]?.text ?? "")
          },
          async status() {
            return { data: {} }
          },
        },
      }
      const pluginInput = { directory: dir, client: mockClient } as unknown as PluginInput
      const store = await getRegistryStore(pluginInput)
      store.register({
        agentId: OUTER_ARCHITECT_ID,
        scope: "outer",
        profile: "architect",
        sessionId: "ses_architect",
        displayName: "Architect",
      })
      store.registerInnerNode({ missionId, nodeId: "node-root", sessionId: "ses_leaf", profile: "build-root" })
      store.registerInnerNode({ missionId, nodeId: "node-doc", sessionId: "ses_doc", profile: "build" })

      writeOrchestrationState(dir, initOrchestrationState(missionId, ["node-root", "node-doc"]))
      await writeManifest(dir, {
        mission_id: missionId,
        status: "running",
        root_node: "node-root",
        created_at: new Date().toISOString(),
        nodes: {
          "node-root": {
            session_id: "ses_leaf",
            parent: null,
            display_name: "node-root",
            description: "root",
            profile: "build-root",
          },
          "node-doc": {
            session_id: "ses_doc",
            parent: "node-root",
            display_name: "node-doc",
            description: "doc",
            profile: "build",
          },
        },
      })

      const state = initOrchestrationState(missionId, ["node-root", "node-doc"])
      expect(orchestrationCanRetry(state, false)).toBe(true)

      const parsed = JSON.parse(
        toolOutput(await bootstrapTreeTool(pluginInput).execute({}, mockToolContext(dir, "architect"))),
      ) as { ok: boolean; data?: { phase?: string } }
      expect(parsed.ok).toBe(true)
      expect(parsed.data?.phase).toBe("orchestration_restarted")
      expect(promptTexts.some((text) => text.includes("执行激活") || text.includes("execution activate"))).toBe(true)
    } finally {
      stopSandboxOrchestration("orch-retry-m1")
      await rm(dir, { recursive: true, force: true })
    }
  })
})
