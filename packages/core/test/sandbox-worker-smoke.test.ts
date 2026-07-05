import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { getRegistryStore } from "../src/registry/context.ts"
import { loadMissionScript } from "../src/orchestration/script-load.ts"
import { initOrchestrationState, writeOrchestrationState } from "../src/orchestration/state.ts"
import { startSandboxOrchestration, stopSandboxOrchestration } from "../src/orchestration/sandbox-runtime.ts"
import { teamNodeOrder } from "../src/orchestration/plan-graph.ts"

describe("sandbox worker smoke", () => {
  test("worker delivers first prompt via RPC", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-worker-smoke-"))
    try {
      const fixture = path.join(import.meta.dir, "fixtures/core-example-smoke-v1/mission.script.ts")
      const missionId = "sandbox-worker-smoke-m1"
      const dest = path.join(dir, ".gatehouse/missions", missionId)
      await Bun.$`mkdir -p ${dest}`.quiet()
      const source = (await Bun.file(fixture).text()).replaceAll("core-example-smoke-v1", missionId)
      await Bun.write(path.join(dest, "mission.script.ts"), source)

      const script = await loadMissionScript(dir, missionId)
      if (!script?.orchestrateSource) throw new Error("missing orchestrate")

      writeOrchestrationState(dir, initOrchestrationState(missionId, teamNodeOrder(script.team)))

      const promptTexts: string[] = []
      let sessionCounter = 0
      const mockClient = {
        session: {
          async create() {
            sessionCounter += 1
            return { id: `ses_${sessionCounter}` }
          },
          async promptAsync(input: { body?: { parts?: { text?: string }[] } }) {
            const text = input.body?.parts?.[0]?.text ?? ""
            promptTexts.push(text)
          },
          async status() {
            return { data: {} }
          },
        },
      }

      const pluginInput = { directory: dir, client: mockClient } as unknown as PluginInput
      const store = await getRegistryStore(pluginInput)
      for (const nodeId of teamNodeOrder(script.team)) {
        store.registerInnerNode({
          missionId,
          nodeId,
          sessionId: `ses_${nodeId}`,
          profile: nodeId === script.team.terminal ? "build" : "build",
        })
      }

      const started = await startSandboxOrchestration({ plugin: pluginInput, store, script })
      expect(started.status).toBe("started")

      await store.flushPendingDeliveries()
      expect(promptTexts.some((text) => text.includes("执行激活") || text.includes("execution activate"))).toBe(
        true,
      )
    } finally {
      stopSandboxOrchestration("sandbox-worker-smoke-m1")
      await rm(dir, { recursive: true, force: true })
    }
  })
})
