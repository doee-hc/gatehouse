import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { bootstrapTreeTool } from "../src/tools/bootstrap.ts"
import { applySkillDomainsTool } from "../src/tools/apply-skill-domains.ts"
import { copyExampleMission } from "./copy-example-mission.ts"
import { readManifest } from "../src/tree/store.ts"
import { isRecord, parseYaml } from "../src/yaml.ts"
import { getRegistryStore } from "../src/registry/context.ts"
import { OUTER_ARCHITECT_ID, OUTER_CURATOR_ID } from "../src/registry/types.ts"
import { gatehouseMessage } from "../src/i18n.ts"
import { startPortalInternalEventCapture, withPortalEnv } from "./portal-test-server.ts"

const scaffoldScript = path.join(import.meta.dir, "../script/scaffold.ts")

function toolOutput(result: Awaited<ReturnType<ReturnType<typeof bootstrapTreeTool>["execute"]>>) {
  return typeof result === "string" ? result : result.output
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
  test("bootstrap_tree from example mission.script with mock client", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-bootstrap-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      await copyExampleMission(dir)

      let sessionCounter = 0
      const createBodies: Record<string, unknown>[] = []
      const promptBodies: Record<string, unknown>[] = []
      const kickoffTexts: string[] = []
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
            if (typeof text === "string" && text.includes("[Gatehouse 消息")) kickoffTexts.push(text)
          },
          async status() {
            return { data: {} }
          },
        },
      }

      const pluginInput = { directory: dir, client: mockClient } as unknown as PluginInput
      const bootstrap = bootstrapTreeTool(pluginInput)

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
      expect(apoOutput).toContain("awaiting_skill_domains")
      expect(apoOutput).toContain("core-example-smoke-v1")
      expect(apoOutput).toContain("script")
      expect(await readManifest(dir, "core-example-smoke-v1")).toBeUndefined()
      expect(sessionCounter).toBe(0)
      expect(kickoffTexts.some((text) => text.includes("skill_domain 分配"))).toBe(true)
      expect(kickoffTexts.some((text) => text.includes("已提交协作脚本"))).toBe(true)

      const apply = applySkillDomainsTool(pluginInput)
      const jiyiOutput = toolOutput(
        await apply.execute(
          { assignments: JSON.stringify({ "node-doc": "docs" }) },
          mockToolContext(dir, "curator", "ses_curator"),
        ),
      )
      const parsed = parseYaml(jiyiOutput)
      if (!isRecord(parsed) || !isRecord(parsed.data)) throw new Error("unexpected apply output")
      expect(parsed.data.phase).toBe("bootstrapped")
      expect(parsed.data.domain_dirs_ensured).toEqual(["docs"])

      const docsDomainDir = path.join(dir, ".gatehouse/skills/by-domain/docs")
      expect((await stat(docsDomainDir)).isDirectory()).toBe(true)

      const manifest = await readManifest(dir, "core-example-smoke-v1")
      expect(manifest?.root_node).toBe("node-root")
      expect(manifest?.nodes["node-root"]?.session_id).toBe("ses_mock_1")
      expect(manifest?.nodes["node-doc"]?.session_id).toBe("ses_mock_2")
      expect(manifest?.nodes["node-doc"]?.skill_domain).toBe("docs")
      expect(manifest?.nodes["node-root"]?.display_name).toBe("root")
      expect(manifest?.nodes["node-doc"]?.display_name).toBe("doc")
      expect(manifest?.nodes["node-root"]?.description).toBe(
        "Mission 任务协调者，分派 node-doc 并汇总交付",
      )
      expect(manifest?.nodes["node-doc"]?.description).toBe("文档执行成员，负责 README 示例章节")
      expect(sessionCounter).toBe(2)
      expect(kickoffTexts.some((text) => text.includes("来自 Gatehouse"))).toBe(true)
      expect(kickoffTexts.some((text) => text.includes("执行激活"))).toBe(true)
      expect(kickoffTexts.some((text) => text.includes("node-doc"))).toBe(true)
      if (!isRecord(parsed.data.bootstrap) || !isRecord(parsed.data.bootstrap.orchestration_runtime)) {
        throw new Error("expected orchestration_runtime in bootstrap output")
      }
      expect(parsed.data.bootstrap.orchestration_runtime.status).toBe("started")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("bootstrap_tree emits architect to curator portal chat", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-bootstrap-portal-chat-"))
    const token = "bootstrap-portal-chat-token"
    const capture = startPortalInternalEventCapture(token)
    try {
      await withPortalEnv(capture.port, token, async () => {
        await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
        await copyExampleMission(dir)

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
        preStore.register({
          agentId: OUTER_CURATOR_ID,
          scope: "outer",
          profile: "curator",
          sessionId: "ses_curator",
          displayName: "Curator",
        })

        await bootstrapTreeTool(pluginInput).execute({}, mockToolContext(dir, "architect"))
        await capture.waitPosted()
      })

      expect(capture.posted).toEqual({
        type: "agent.chat",
        fromSpawnId: "architect",
        toSpawnId: "curator",
        text: gatehouseMessage("portal.architectBootstrapCuratorHint", "zh"),
      })
    } finally {
      capture.server.stop()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("bootstrap_tree rejects architect kickoff when mission is not running", async () => {
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
        await bootstrapTreeTool(pluginInput).execute(
          {},
          mockToolContext(dir, "architect"),
        ),
      )
      expect(output).toContain("MISSION_NOT_RUNNING")
      expect(output).toContain("queued")
      expect(await readManifest(dir, "core-example-smoke-v1")).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
