import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { submitOrchestrationTool } from "../src/tools/submit-orchestration.ts"
import { applySkillDomainsTool } from "../src/tools/apply-skill-domains.ts"
import { missionRetroTool } from "../src/tools/retro.ts"
import { copyExampleMission } from "./copy-example-mission.ts"
import { seedSubmittedDelivery } from "./seed-delivery.ts"
import { readMissionManifest } from "../src/missions/manifest/store.ts"
import { isRecord } from "../src/yaml.ts"
import { getRegistryStore } from "../src/registry/context.ts"
import { OUTER_ARCHITECT_ID, OUTER_CURATOR_ID, OUTER_LEAD_ID } from "../src/registry/types.ts"
import { stopSandboxOrchestration } from "../src/orchestration/sandbox/runtime.ts"
import { hasOrchestrationRuntime } from "../src/orchestration/state/store.ts"
import { startPortalInternalEventCapture, withPortalEnv } from "./portal-test-server.ts"

const scaffoldScript = path.join(import.meta.dir, "../script/scaffold.ts")

function toolOutput(result: Awaited<ReturnType<ReturnType<typeof submitOrchestrationTool>["execute"]>>) {
  return typeof result === "string" ? result : result.output
}

function parseToolOutput(output: string) {
  return JSON.parse(output) as unknown
}

async function registerLeadForTest(pluginInput: PluginInput, sessionId = "ses_lead") {
  const registry = await getRegistryStore(pluginInput)
  registry.register({
    agentId: OUTER_LEAD_ID,
    scope: "outer",
    profile: "lead",
    sessionId,
    displayName: "Lead",
  })
}

function mockToolContext(directory: string, agent = "architect", sessionID = "ses_architect_test"): ToolContext {
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

describe("example flow", () => {
  test("submit_orchestration from example mission.script with mock client", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-bootstrap-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      await copyExampleMission(dir)

      let sessionCounter = 0
      const createBodies: Record<string, unknown>[] = []
      const promptBodies: Record<string, unknown>[] = []
      const kickoffTexts: string[] = []
      const promptTexts: string[] = []
      const mockClient = {
        session: {
          async create(input: { body?: Record<string, unknown> }) {
            sessionCounter += 1
            createBodies.push(input.body ?? {})
            return { id: `ses_mock_${sessionCounter}` }
          },
          async promptAsync(input: { path?: { id: string }; body?: Record<string, unknown> }) {
            promptBodies.push(input.body ?? {})
            const parts = input.body?.parts as { text?: string }[] | undefined
            const text = parts?.[0]?.text
            if (typeof text === "string") {
              promptTexts.push(text)
              if (text.includes("[Gatehouse 消息")) kickoffTexts.push(text)
            }
          },
          async update() {},
          async messages() {
            return { data: [] }
          },
          async get() {
            return { data: { time: { created: 0, updated: 1000 } } }
          },
          async status() {
            return { data: {} }
          },
          async todo() {
            return { data: [] }
          },
        },
      }

      const pluginInput = { directory: dir, client: mockClient } as unknown as PluginInput
      const bootstrap = submitOrchestrationTool(pluginInput)

      const preStore = await getRegistryStore(pluginInput)
      preStore.register({
        agentId: OUTER_ARCHITECT_ID,
        scope: "outer",
        profile: "architect",
        sessionId: "ses_architect",
        displayName: "Architect",
      })
      preStore.register({
        agentId: OUTER_CURATOR_ID,
        scope: "outer",
        profile: "curator",
        sessionId: "ses_curator",
        displayName: "Curator",
      })

      const apoOutput = toolOutput(
        await bootstrap.execute({}, mockToolContext(dir, "architect")),
      )
      expect(apoOutput).toContain("bootstrapped")
      expect(apoOutput).toContain("deferred_to_retro")
      expect(apoOutput).toContain("core-example-smoke-v1")
      expect(sessionCounter).toBe(2)
      expect(kickoffTexts.some((text) => text.includes("skill_domain 分配"))).toBe(false)

      const manifestAfterSubmit = await readMissionManifest(dir, "core-example-smoke-v1")
      expect(manifestAfterSubmit?.nodes["node-doc"]?.skill_domain).toBeUndefined()
      expect(hasOrchestrationRuntime(dir, "core-example-smoke-v1")).toBe(true)

      await registerLeadForTest(pluginInput, "ses_lead")
      await seedSubmittedDelivery(dir, "core-example-smoke-v1")
      kickoffTexts.length = 0
      promptTexts.length = 0

      const retroOutput = toolOutput(
        await missionRetroTool(pluginInput).execute({}, mockToolContext(dir, "lead", "ses_lead")),
      )
      expect(retroOutput).toContain("skill_assignment_pending")
      expect(promptTexts.some((text) => text.includes("skill_domain 分配"))).toBe(true)

      const jiyiOutput = toolOutput(
        await applySkillDomainsTool(pluginInput).execute(
          { assignments: [{ node_id: "node-doc", domain_id: "docs" }] },
          mockToolContext(dir, "curator", "ses_curator"),
        ),
      )
      const parsed = parseToolOutput(jiyiOutput)
      if (!isRecord(parsed) || !isRecord(parsed.data)) throw new Error("unexpected apply output")
      expect(parsed.ok).toBe(true)
      expect(parsed.data.phase).toBe("retro_extract_started")
      expect(parsed.data.applied).toBe(1)

      const manifest = await readMissionManifest(dir, "core-example-smoke-v1")
      expect(manifest?.terminal_node).toBe("node-root")
      const rootSessionId = manifest?.nodes["node-root"]?.session_id
      const docSessionId = manifest?.nodes["node-doc"]?.session_id
      expect(new Set([rootSessionId, docSessionId])).toEqual(new Set(["ses_mock_1", "ses_mock_2"]))
      expect(manifest?.nodes["node-doc"]?.skill_domain).toBe("docs")
      expect(manifest?.nodes["node-root"]?.display_name).toBe("root")
      expect(manifest?.nodes["node-doc"]?.display_name).toBe("doc")
      expect(manifest?.nodes["node-root"]?.description).toBe(
        "Mission 汇总节点，汇总验收 node-doc 交付并向上汇报",
      )
      expect(manifest?.nodes["node-doc"]?.description).toBe("文档执行成员，负责 README 示例章节")
      expect(sessionCounter).toBeGreaterThanOrEqual(3)
      expect(hasOrchestrationRuntime(dir, "core-example-smoke-v1")).toBe(true)
    } finally {
      stopSandboxOrchestration("core-example-smoke-v1")
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("submit_orchestration does not emit architect to curator portal chat", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-retro-skill-assign-kickoff-"))
    const token = "retro-skill-assign-kickoff-token"
    const capture = await startPortalInternalEventCapture(token)
    try {
      await withPortalEnv(capture, token, async () => {
        await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
        await copyExampleMission(dir)

        const mockClient = {
          session: {
            async create() {
              return { id: "ses_created" }
            },
            async promptAsync() {},
            async update() {},
            async messages() {
              return { data: [] }
            },
            async get() {
              return { data: { time: { created: 0, updated: 1000 } } }
            },
            async status() {
              return { data: {} }
            },
            async todo() {
              return { data: [] }
            },
          },
        }

        const pluginInput = { directory: dir, client: mockClient } as unknown as PluginInput
        const preStore = await getRegistryStore(pluginInput)
        preStore.register({
          agentId: OUTER_ARCHITECT_ID,
          scope: "outer",
          profile: "architect",
          sessionId: "ses_architect",
          displayName: "Architect",
        })
        preStore.register({
          agentId: OUTER_CURATOR_ID,
          scope: "outer",
          profile: "curator",
          sessionId: "ses_curator",
          displayName: "Curator",
        })
        await registerLeadForTest(pluginInput, "ses_lead")

        await submitOrchestrationTool(pluginInput).execute({}, mockToolContext(dir, "architect"))
        await seedSubmittedDelivery(dir, "core-example-smoke-v1")
        await missionRetroTool(pluginInput).execute({}, mockToolContext(dir, "ses_lead", "lead"))
        await capture.waitPosted()
      })

      const posted = Array.isArray(capture.posted) ? capture.posted : [capture.posted]
      expect(
        posted.some(
          (event) =>
            isRecord(event) &&
            event.type === "agent.chat" &&
            event.fromSpawnId === "architect" &&
            event.toSpawnId === "curator",
        ),
      ).toBe(false)
    } finally {
      capture.server.stop()
      stopSandboxOrchestration("core-example-smoke-v1")
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("submit_orchestration rejects architect kickoff when mission is not running", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-bootstrap-guard-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      await copyExampleMission(dir)
      const missionsPath = path.join(dir, ".gatehouse/lead/missions.yaml")
      const missions = Bun.YAML.parse(await Bun.file(missionsPath).text()) as {
        missions: Array<{ id: string; status: string; objective?: string }>
      }
      const entry = missions.missions.find((mission) => mission.id === "core-example-smoke-v1")
      if (!entry) throw new Error("fixture mission missing")
      entry.status = "queued"
      await Bun.write(missionsPath, Bun.YAML.stringify(missions))

      const mockClient = {
        session: {
          async create() {
            throw new Error("should not create sessions")
          },
          async promptAsync() {},
          async status() {
            return { data: {} }
          },
        },
      }
      const pluginInput = { directory: dir, client: mockClient } as unknown as PluginInput
      const preStore = await getRegistryStore(pluginInput)
      preStore.register({
        agentId: OUTER_ARCHITECT_ID,
        scope: "outer",
        profile: "architect",
        sessionId: "ses_architect",
        displayName: "Architect",
      })

      const output = toolOutput(
        await submitOrchestrationTool(pluginInput).execute(
          {},
          mockToolContext(dir, "architect"),
        ),
      )
      expect(output).toContain("MISSION_NOT_RUNNING")
      expect(output).toContain("queued")
      expect(await readMissionManifest(dir, "core-example-smoke-v1")).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
