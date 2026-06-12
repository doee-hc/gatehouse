import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { RegistryStore } from "../src/registry/store.ts"
import { getRegistryStore } from "../src/registry/context.ts"
import { OUTER_ARCHITECT_ID, OUTER_LEAD_ID, OUTER_CURATOR_ID } from "../src/registry/types.ts"
import type { GatehouseClient } from "../src/session/client.ts"
import { sendMessageTool } from "../src/tools/send-message.ts"
import { initTeamTool } from "../src/tools/init-team.ts"
import { bootstrapTreeTool } from "../src/tools/bootstrap.ts"
import { applySkillDomainsTool } from "../src/tools/apply-skill-domains.ts"
import { copyExampleMission, seedActiveMissionRegistry } from "./copy-example-mission.ts"
import { startPortalInternalEventCapture, withPortalEnv } from "./portal-test-server.ts"

const scaffoldScript = path.join(import.meta.dir, "../script/scaffold.ts")

function mockClientMinimal(): GatehouseClient {
  return {
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
}

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

function toolOutput(result: Awaited<ReturnType<ReturnType<typeof sendMessageTool>["execute"]>>) {
  return typeof result === "string" ? result : result.output
}

describe("registry harness", () => {
  test("send_message to architect fails before init_team", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-registry-"))
    try {
      const mockClient = mockClientMinimal()
      const store = await RegistryStore.create({ directory: dir, client: mockClient })
      store.registerOuterSession({
        profile: "lead",
        sessionId: "ses_lead",
        projectRootSessionId: "ses_lead",
      })

      const send = sendMessageTool({ directory: dir, client: mockClient } as unknown as PluginInput)
      const output = toolOutput(
        await send.execute(
          { recipient: "architect", message: "Mission core-example-smoke-v1 已确认，请 gatehouse_mission_current 后建队。" },
          mockToolContext(dir, "ses_lead", "lead"),
        ),
      )
      expect(output).toContain("RECIPIENT_NOT_FOUND")
      expect(output).toContain("gatehouse_init_team")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init_team rejects a second unregistered lead session", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-registry-dup-lead-"))
    try {
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

      const store = await RegistryStore.create({ directory: dir, client: mockClient })
      store.registerOuterSession({
        profile: "lead",
        sessionId: "ses_lead",
        projectRootSessionId: "ses_lead",
      })

      const init = initTeamTool({ directory: dir, client: mockClient } as unknown as PluginInput)
      const output = toolOutput(await init.execute({}, mockToolContext(dir, "ses_other_lead", "lead")))
      expect(output).toContain("registered lead session")
      expect(store.byAgentId(OUTER_LEAD_ID)?.sessionId).toBe("ses_lead")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init_team registers outer agents and send_message delivers to architect", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-registry-"))
    try {
      let sessionCounter = 0
      const createCalls: { agent?: string }[] = []
      const promptCalls: { sessionId: string; text: string; agent?: string; system?: string; noReply?: boolean }[] = []
      const mockClient: GatehouseClient = {
        session: {
          async create(input: unknown) {
            sessionCounter += 1
            const record = input as { body?: { agent?: string } }
            createCalls.push({ agent: record.body?.agent })
            return { id: `ses_architect_${sessionCounter}` }
          },
          async promptAsync(input: unknown) {
            const record = input as {
              path: { id: string }
              body: { agent?: string; parts: { text: string }[]; system?: string; noReply?: boolean }
            }
            promptCalls.push({
              sessionId: record.path.id,
              text: record.body.parts[0]?.text ?? "",
              agent: record.body.agent,
              system: record.body.system,
              noReply: record.body.noReply,
            })
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

      const store = await RegistryStore.create({ directory: dir, client: mockClient })
      store.registerOuterSession({
        profile: "lead",
        sessionId: "ses_lead",
        projectRootSessionId: "ses_lead",
      })

      const init = initTeamTool({ directory: dir, client: mockClient } as unknown as PluginInput)
      const initOutput = toolOutput(await init.execute({}, mockToolContext(dir, "ses_lead", "lead")))
      expect(initOutput).toContain("architect")
      expect(initOutput).toContain("curator")
      expect(initOutput).toContain("arbiter")
      expect(createCalls.map((call) => call.agent)).toEqual(["architect", "curator", "arbiter"])

      const send = sendMessageTool({ directory: dir, client: mockClient } as unknown as PluginInput)
      const output = toolOutput(
        await send.execute(
          {
            recipient: "architect",
            message: "Mission core-example-smoke-v1 已确认，请 gatehouse_mission_current 后建队。",
          },
          mockToolContext(dir, "ses_lead", "lead"),
        ),
      )

      expect(output).toContain("ses_architect_1")
      expect(output).toContain("delivery")
      expect(createCalls.filter((call) => call.agent === "architect")).toHaveLength(1)
      expect(promptCalls.filter((call) => call.sessionId === "ses_architect_1")).toHaveLength(2)
      expect(promptCalls.find((call) => call.text.includes("Mission core-example-smoke-v1"))?.text).toContain(
        "Mission core-example-smoke-v1",
      )

      const registry = await getRegistryStore({ directory: dir, client: mockClient } as unknown as PluginInput)
      const architect = registry.byProfile("architect", "outer")
      expect(architect?.agentId).toBe(OUTER_ARCHITECT_ID)
      expect(architect?.sessionId).toBe("ses_architect_1")
      expect(await Bun.file(registry.dbPath).exists()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("send_message emits agent.chat to portal api when delivered", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-registry-portal-chat-"))
    const token = "registry-test-token"
    const capture = startPortalInternalEventCapture(token)
    try {
      await withPortalEnv(capture.port, token, async () => {
        let sessionCounter = 0
        const mockClient: GatehouseClient = {
          session: {
            async create(input: unknown) {
              sessionCounter += 1
              const record = input as { body?: { agent?: string } }
              return { id: `ses_architect_${sessionCounter}` }
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
        const init = initTeamTool({ directory: dir, client: mockClient } as unknown as PluginInput)
        await init.execute({}, mockToolContext(dir, "ses_lead", "lead"))

        const send = sendMessageTool({ directory: dir, client: mockClient } as unknown as PluginInput)
        await send.execute(
          { recipient: "architect", message: "portal chat test" },
          mockToolContext(dir, "ses_lead", "lead"),
        )
        await capture.waitPosted()
      })

      expect(capture.posted).toEqual({
        type: "agent.chat",
        fromSpawnId: "lead",
        toSpawnId: "architect",
        text: "portal chat test",
      })
    } finally {
      capture.server.stop()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("architect send_message to node_id resolves retro after fork", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-registry-retro-resolve-"))
    try {
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
      const store = await getRegistryStore(pluginInput)
      store.register({
        agentId: OUTER_ARCHITECT_ID,
        scope: "outer",
        profile: "architect",
        sessionId: "ses_architect",
        displayName: "Architect",
      })
      store.registerInnerNode({
        missionId: "m1",
        nodeId: "node-root",
        profile: "build-root",
        sessionId: "ses_exec_root",
      })
      store.registerRetroNode({
        missionId: "m1",
        nodeId: "node-root",
        profile: "build-root",
        sessionId: "ses_retro_root",
      })

      const resolution = store.resolveRecipient("node-root", {
        missionId: "m1",
        sender: store.bySession("ses_architect"),
      })
      expect(resolution.status).toBe("resolved")
      if (resolution.status === "resolved") expect(resolution.recipient.scope).toBe("retro")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("intermediate build-coordinator cannot send_message to lead", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-registry-mid-lead-deny-"))
    try {
      const pluginInput = { directory: dir, client: mockClientMinimal() } as unknown as PluginInput
      const store = await getRegistryStore(pluginInput)
      store.registerOuterSession({
        profile: "lead",
        sessionId: "ses_lead",
        projectRootSessionId: "ses_lead",
      })
      store.registerInnerNode({
        missionId: "m1",
        nodeId: "node-mid",
        profile: "build-coordinator",
        sessionId: "ses_mid",
        parentSessionId: "ses_root",
      })
      const send = sendMessageTool(pluginInput)
      const output = toolOutput(
        await send.execute(
          { recipient: "lead", message: "subtree done" },
          mockToolContext(dir, "ses_mid", "build-coordinator"),
        ),
      )
      expect(output).toContain("SEND_FORBIDDEN")
      expect(output).toContain("build-root")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("inner leaf cannot send_message to hengduan", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-registry-inner-hengduan-deny-"))
    try {
      const pluginInput = { directory: dir, client: mockClientMinimal() } as unknown as PluginInput
      const store = await getRegistryStore(pluginInput)
      store.registerOuterSession({
        profile: "lead",
        sessionId: "ses_lead",
        projectRootSessionId: "ses_lead",
      })
      store.registerInnerNode({
        missionId: "m1",
        nodeId: "node-doc",
        profile: "build",
        sessionId: "ses_doc",
        parentSessionId: "ses_root",
      })
      const send = sendMessageTool(pluginInput)
      const output = toolOutput(
        await send.execute(
          { recipient: "lead", message: "hi" },
          mockToolContext(dir, "ses_doc", "build"),
        ),
      )
      expect(output).toContain("SEND_FORBIDDEN")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("inner leaf cannot send_message to architect", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-registry-inner-architect-deny-"))
    try {
      const pluginInput = { directory: dir, client: mockClientMinimal() } as unknown as PluginInput
      const store = await getRegistryStore(pluginInput)
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
        parentSessionId: "ses_root",
      })
      const send = sendMessageTool(pluginInput)
      const output = toolOutput(
        await send.execute(
          { recipient: "architect", message: "hi" },
          mockToolContext(dir, "ses_doc", "build"),
        ),
      )
      expect(output).toContain("SEND_FORBIDDEN")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("solo build-root-solo can send_message to lead", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-registry-solo-root-lead-"))
    try {
      const pluginInput = { directory: dir, client: mockClientMinimal() } as unknown as PluginInput
      const store = await getRegistryStore(pluginInput)
      store.registerOuterSession({
        profile: "lead",
        sessionId: "ses_lead",
        projectRootSessionId: "ses_lead",
      })
      store.registerInnerNode({
        missionId: "m1",
        nodeId: "node-root",
        profile: "build-root-solo",
        sessionId: "ses_root",
      })
      const send = sendMessageTool(pluginInput)
      const output = toolOutput(
        await send.execute(
          { recipient: "lead", message: "solo done" },
          mockToolContext(dir, "ses_root", "build-root-solo"),
        ),
      )
      expect(output).toContain("ses_lead")
      expect(output).not.toContain("SEND_FORBIDDEN")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("structural root can send_message to hengduan", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-registry-root-hengduan-"))
    try {
      const mockClient = mockClientMinimal()
      const pluginInput = { directory: dir, client: mockClient } as unknown as PluginInput
      const store = await getRegistryStore(pluginInput)
      store.registerOuterSession({
        profile: "lead",
        sessionId: "ses_lead",
        projectRootSessionId: "ses_lead",
      })
      store.registerInnerNode({
        missionId: "m1",
        nodeId: "node-root",
        profile: "build-root",
        sessionId: "ses_root",
      })
      const send = sendMessageTool(pluginInput)
      const output = toolOutput(
        await send.execute(
          { recipient: "lead", message: "mission done" },
          mockToolContext(dir, "ses_root", "build-root"),
        ),
      )
      expect(output).toContain("ses_lead")
      expect(output).toContain("delivery")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("inner structural root send_message emits agent.chat with node spawn id", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-registry-inner-portal-chat-"))
    const token = "registry-test-token"
    const capture = startPortalInternalEventCapture(token)
    try {
      await withPortalEnv(capture.port, token, async () => {
        const pluginInput = { directory: dir, client: mockClientMinimal() } as unknown as PluginInput
        const store = await getRegistryStore(pluginInput)
        store.registerOuterSession({
          profile: "lead",
          sessionId: "ses_lead",
          projectRootSessionId: "ses_lead",
        })
        store.registerInnerNode({
          missionId: "m1",
          nodeId: "node-root",
          profile: "build-root",
          sessionId: "ses_root",
        })
        const send = sendMessageTool(pluginInput)
        await send.execute(
          { recipient: "lead", message: "inner portal chat" },
          mockToolContext(dir, "ses_root", "build-root"),
        )
        await capture.waitPosted()
      })

      expect(capture.posted).toEqual({
        type: "agent.chat",
        fromSpawnId: "node-root",
        toSpawnId: "lead",
        text: "inner portal chat",
      })
    } finally {
      capture.server.stop()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("structural root cannot send_message to architect", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-registry-root-architect-deny-"))
    try {
      const mockClient = mockClientMinimal()
      const pluginInput = { directory: dir, client: mockClient } as unknown as PluginInput
      const store = await getRegistryStore(pluginInput)
      store.register({
        agentId: OUTER_ARCHITECT_ID,
        scope: "outer",
        profile: "architect",
        sessionId: "ses_architect",
        displayName: "Architect",
      })
      store.registerInnerNode({
        missionId: "m1",
        nodeId: "node-root",
        profile: "build-root",
        sessionId: "ses_root",
      })
      const send = sendMessageTool(pluginInput)
      const output = toolOutput(
        await send.execute(
          { recipient: "architect", message: "mission done" },
          mockToolContext(dir, "ses_root", "build-root"),
        ),
      )
      expect(output).toContain("SEND_FORBIDDEN")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("retro_record notifies architect when all expected nodes complete", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-registry-retro-notify-"))
    try {
      const promptCalls: { sessionId: string; text: string }[] = []
      const mockClient: GatehouseClient = {
        session: {
          async create() {
            return { id: "ses_unused" }
          },
          async promptAsync(input: unknown) {
            const record = input as {
              path: { id: string }
              body: { parts: { text: string }[] }
            }
            promptCalls.push({
              sessionId: record.path.id,
              text: record.body.parts[0]?.text ?? "",
            })
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
      const store = await getRegistryStore(pluginInput)
      store.register({
        agentId: OUTER_ARCHITECT_ID,
        scope: "outer",
        profile: "architect",
        sessionId: "ses_architect",
        displayName: "Architect",
      })
      store.registerRetroNode({
        missionId: "m1",
        nodeId: "node-root",
        profile: "build-coordinator",
        sessionId: "ses_retro_root",
      })
      store.beginRetroRun("m1", ["node-root"])
      const reportRel = ".gatehouse/trees/m1/reports/nodes/node-root-retro.md"
      await Bun.write(path.join(dir, reportRel), "# retro\n")
      await store.recordRetroCompletion({
        missionId: "m1",
        nodeId: "node-root",
        sessionId: "ses_retro_root",
        reportPath: reportRel,
      })
      expect(store.byAgentId("retro:m1:node-root")?.status).toBe("completed")
      expect(promptCalls).toHaveLength(1)
      expect(promptCalls[0]?.sessionId).toBe("ses_architect")
      expect(promptCalls[0]?.text).toContain("复盘就绪")
      expect(store.retroStatus("m1").status === "ok" && store.retroStatus("m1").architectNotified).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("hengduan cannot send_message to inner leaf nodes", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-registry-policy-"))
    try {
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
      const store = await getRegistryStore(pluginInput)
      store.registerOuterSession({
        profile: "lead",
        sessionId: "ses_lead",
        projectRootSessionId: "ses_lead",
      })
      store.registerInnerNode({
        missionId: "m1",
        nodeId: "node-root",
        profile: "build-root",
        sessionId: "ses_root",
      })
      store.registerInnerNode({
        missionId: "m1",
        nodeId: "node-doc",
        profile: "build",
        sessionId: "ses_doc",
        parentSessionId: "ses_root",
      })
      seedActiveMissionRegistry(dir, "m1")

      const send = sendMessageTool(pluginInput)
      const output = toolOutput(
        await send.execute(
          { recipient: "node-doc", message: "hi" },
          mockToolContext(dir, "ses_lead", "lead"),
        ),
      )
      expect(output).toContain("SEND_FORBIDDEN")
      expect(output).toContain("profile lead")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("hengduan can send_message to structural root", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-registry-hengduan-root-"))
    try {
      const mockClient = mockClientMinimal()
      const pluginInput = { directory: dir, client: mockClient } as unknown as PluginInput
      const store = await getRegistryStore(pluginInput)
      store.registerOuterSession({
        profile: "lead",
        sessionId: "ses_lead",
        projectRootSessionId: "ses_lead",
      })
      store.registerInnerNode({
        missionId: "m1",
        nodeId: "node-root",
        profile: "build-root",
        sessionId: "ses_root",
      })
      seedActiveMissionRegistry(dir, "m1")

      const send = sendMessageTool(pluginInput)
      const output = toolOutput(
        await send.execute(
          { recipient: "node-root", message: "用户要求继续改进" },
          mockToolContext(dir, "ses_lead", "lead"),
        ),
      )
      expect(output).toContain("ses_root")
      expect(output).toContain("delivery")
      expect(output).not.toContain("SEND_FORBIDDEN")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("bootstrap syncs inner nodes into registry.db", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-registry-bootstrap-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      await copyExampleMission(dir)

      let sessionCounter = 0
      const mockClient: GatehouseClient = {
        session: {
          async create() {
            sessionCounter += 1
            return { id: `ses_inner_${sessionCounter}` }
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
      const preStore = await RegistryStore.create({ directory: dir, client: mockClient })
      preStore.register({
        agentId: OUTER_CURATOR_ID,
        scope: "outer",
        profile: "curator",
        sessionId: "ses_curator",
        displayName: "Curator",
      })

      const bootstrap = bootstrapTreeTool(pluginInput)
      await bootstrap.execute({}, mockToolContext(dir, "ses_architect", "architect"))

      const apply = applySkillDomainsTool(pluginInput)
      await apply.execute(
        { assignments: JSON.stringify({ "node-doc": "docs" }) },
        mockToolContext(dir, "ses_curator", "curator"),
      )

      const store = await RegistryStore.create({ directory: dir, client: mockClient })
      const inner = store.list({ scope: "inner", missionId: "core-example-smoke-v1" })
      expect(inner).toHaveLength(2)
      expect(inner.map((item) => item.nodeId).sort()).toEqual(["node-doc", "node-root"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("hengduan registry row persists after reload", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-registry-reload-"))
    try {
      const mockClient: GatehouseClient = {
        session: {
          async create() {
            return { id: "ses_architect_reload" }
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
      const first = await RegistryStore.create({ directory: dir, client: mockClient })
      first.registerOuterSession({
        profile: "lead",
        sessionId: "ses_lead_reload",
        projectRootSessionId: "ses_lead_reload",
      })

      const second = await RegistryStore.create({ directory: dir, client: mockClient })
      expect(second.byAgentId(OUTER_LEAD_ID)?.sessionId).toBe("ses_lead_reload")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("applyGatehouseConfig", () => {
  test("denies task for lead and allows send_message", async () => {
    const { applyGatehouseConfig } = await import("../src/setup/config.ts")
    const cfg = { profile: {} } as Record<string, unknown>
    await applyGatehouseConfig(cfg as never)
    const agents = cfg.agent as Record<string, Record<string, unknown>>
    expect((agents["lead"]?.permission as Record<string, string>).task).toBe("deny")
    expect((agents["lead"]?.permission as Record<string, string>).gatehouse_init_team).toBe("allow")
    expect((agents["lead"]?.permission as Record<string, string>).gatehouse_send_message).toBe("allow")
  })

  test("registers inner coordinator profiles with task denied", async () => {
    const { applyGatehouseConfig } = await import("../src/setup/config.ts")
    const cfg = { profile: {} } as Record<string, unknown>
    await applyGatehouseConfig(cfg as never)
    const agents = cfg.agent as Record<string, Record<string, unknown>>
    for (const profile of ["build-root", "build-coordinator"] as const) {
      const permission = agents[profile]?.permission as Record<string, string>
      expect(agents[profile]?.mode).toBe("primary")
      expect(permission.task).toBe("deny")
      expect(permission.gatehouse_send_message).toBe("allow")
      expect(permission.gatehouse_mission_current).toBe("deny")
      const tools = agents[profile]?.tools as Record<string, boolean>
      expect(tools.gatehouse_mission_current).toBe(false)
    }
    const soloPermission = agents["build-root-solo"]?.permission as Record<string, string>
    expect(soloPermission.task).toBe("allow")
    expect(soloPermission.gatehouse_send_message).toBe("allow")

    const buildPermission = agents["build"]?.permission as Record<string, string>
    expect(buildPermission.gatehouse_mission_current).toBe("deny")
    const buildTools = agents["build"]?.tools as Record<string, boolean>
    expect(buildTools.gatehouse_mission_current).toBe(false)
  })

  test("sets global gatehouse_skill_extract_record for inner build profiles", async () => {
    const { applyGatehouseConfig } = await import("../src/setup/config.ts")
    const cfg = { profile: {} } as Record<string, unknown>
    await applyGatehouseConfig(cfg as never)
    expect((cfg.permission as Record<string, string>).gatehouse_skill_extract_record).toBe("allow")
    const leadPermission = (cfg.agent as Record<string, Record<string, unknown>>)["lead"]?.permission as Record<
      string,
      string
    >
    expect(leadPermission.gatehouse_skill_extract_record).toBe("deny")
  })

  test("registers architect with bootstrap permissions", async () => {
    const { applyGatehouseConfig } = await import("../src/setup/config.ts")
    const cfg = { profile: {} } as Record<string, unknown>
    await applyGatehouseConfig(cfg as never)
    const agents = cfg.agent as Record<string, Record<string, unknown>>
    const permission = agents["architect"]?.permission as Record<string, string>
    expect(agents["architect"]?.mode).toBe("primary")
    expect(permission.task).toBe("deny")
    expect(permission.gatehouse_bootstrap_tree).toBe("allow")
    expect(permission.gatehouse_send_message).toBe("allow")
  })

  test("hides denied tools from all gatehouse profiles", async () => {
    const { applyGatehouseConfig } = await import("../src/setup/config.ts")
    const { hiddenToolsFromPermissions, leadPermissions, arbiterSessionPermissions } = await import(
      "../src/setup/permissions.ts",
    )
    const cfg = { profile: {} } as Record<string, unknown>
    await applyGatehouseConfig(cfg as never)
    const agents = cfg.agent as Record<string, Record<string, unknown>>

    expect(agents["lead"]?.tools).toEqual(hiddenToolsFromPermissions(leadPermissions))
    expect(agents["arbiter"]?.tools).toEqual(hiddenToolsFromPermissions(arbiterSessionPermissions))
    expect((agents["arbiter"]?.tools as Record<string, boolean>).gatehouse_inspector_queue).toBeUndefined()
  })
})
