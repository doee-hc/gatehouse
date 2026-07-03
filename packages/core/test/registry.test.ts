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
import { submitOrchestrationTool } from "../src/tools/submit-orchestration.ts"
import { applySkillDomainsTool } from "../src/tools/apply-skill-domains.ts"
import { stopSandboxOrchestration } from "../src/orchestration/sandbox-runtime.ts"
import { copyExampleMission, seedActiveMissionRegistry } from "./copy-example-mission.ts"
import { seedTerminalPlan } from "./seed-terminal-plan.ts"
import { startPortalInternalEventCapture, withPortalEnv } from "./portal-test-server.ts"
import { readBlogPublishedDocument } from "../src/portal/blog-publish.ts"

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
          { recipient: "architect", message: "Mission core-example-smoke-v1 已确认，请 gatehouse_mission_info 后建队。" },
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
            message: "Mission core-example-smoke-v1 已确认，请 gatehouse_mission_info 后建队。",
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
    const capture = await startPortalInternalEventCapture(token)
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

  test("architect cannot send_message to inner execution node", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-registry-architect-inner-deny-"))
    try {
      const pluginInput = { directory: dir, client: mockClientMinimal() } as unknown as PluginInput
      const store = await getRegistryStore(pluginInput)
      store.registerOuterSession({
        profile: "lead",
        sessionId: "ses_lead",
        projectRootSessionId: "ses_lead",
      })
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
        profile: "build",
        sessionId: "ses_exec_root",
      })
      seedActiveMissionRegistry(dir, "m1")

      const send = sendMessageTool(pluginInput)
      const output = toolOutput(
        await send.execute(
          { recipient: "node-root", message: "please hurry" },
          mockToolContext(dir, "ses_architect", "architect"),
        ),
      )
      expect(output).toContain("SEND_FORBIDDEN")
      expect(output).toContain("profile architect")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("intermediate build cannot send_message to lead", async () => {
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
        profile: "build",
        sessionId: "ses_mid",
      })
      const send = sendMessageTool(pluginInput)
      const output = toolOutput(
        await send.execute(
          { recipient: "lead", message: "subtree done" },
          mockToolContext(dir, "ses_mid", "build"),
        ),
      )
      expect(output).toContain("NOT_AUTHORIZED")
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
      })
      const send = sendMessageTool(pluginInput)
      const output = toolOutput(
        await send.execute(
          { recipient: "lead", message: "hi" },
          mockToolContext(dir, "ses_doc", "build"),
        ),
      )
      expect(output).toContain("NOT_AUTHORIZED")
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
      })
      const send = sendMessageTool(pluginInput)
      const output = toolOutput(
        await send.execute(
          { recipient: "architect", message: "hi" },
          mockToolContext(dir, "ses_doc", "build"),
        ),
      )
      expect(output).toContain("NOT_AUTHORIZED")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("inner terminal node cannot use send_message tool", async () => {
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
        profile: "build",
        sessionId: "ses_root",
      })
      const send = sendMessageTool(pluginInput)
      const output = toolOutput(
        await send.execute(
          { recipient: "lead", message: "solo done" },
          mockToolContext(dir, "ses_root", "build"),
        ),
      )
      expect(output).toContain("NOT_AUTHORIZED")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("store.sendMessage rejects inner senders", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-registry-inner-send-deny-"))
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
        profile: "build",
        sessionId: "ses_root",
      })
      const result = await store.sendMessage({
        senderSessionId: "ses_root",
        senderProfile: "build",
        recipientQuery: "lead",
        message: "mission done",
      })
      expect(result.status).toBe("forbidden")
      if (result.status === "forbidden") {
        expect(result.reason).toContain("outer-team only")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("deliverSystemNotification delivers terminal node notification to lead", async () => {
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
        profile: "build",
        sessionId: "ses_root",
      })
      seedTerminalPlan(dir, "m1", "node-root")
      const result = await store.deliverSystemNotification({
        senderSessionId: "ses_root",
        recipientQuery: "lead",
        message: "mission done",
      })
      expect(result.status).not.toBe("forbidden")
      if (result.status === "sent" || result.status === "queued") {
        expect(result.recipient.sessionId).toBe("ses_lead")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("deliverSystemNotification rejects non-terminal inner notify to lead", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-registry-mid-system-notify-deny-"))
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
        profile: "build",
        sessionId: "ses_mid",
      })
      const result = await store.deliverSystemNotification({
        senderSessionId: "ses_mid",
        recipientQuery: "lead",
        message: "subtree done",
      })
      expect(result.status).toBe("forbidden")
      if (result.status === "forbidden") {
        expect(result.reason).toContain("terminal node")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("deliverSystemNotification from inner root emits agent.chat with node spawn id", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-registry-inner-portal-chat-"))
    const token = "registry-test-token"
    const capture = await startPortalInternalEventCapture(token)
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
          profile: "build",
          sessionId: "ses_root",
        })
        seedTerminalPlan(dir, "m1", "node-root")
        await store.deliverSystemNotification({
          senderSessionId: "ses_root",
          recipientQuery: "lead",
          message: "inner portal chat",
        })
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

  test("terminal node cannot send_message to architect", async () => {
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
        profile: "build",
        sessionId: "ses_root",
      })
      const send = sendMessageTool(pluginInput)
      const output = toolOutput(
        await send.execute(
          { recipient: "architect", message: "mission done" },
          mockToolContext(dir, "ses_root", "build"),
        ),
      )
      expect(output).toContain("NOT_AUTHORIZED")
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
      store.registerRetroAnalyst({
        missionId: "m1",
        sessionId: "ses_retro_root",
      })
      store.beginRetroRun("m1")
      const reportRel = ".gatehouse/trees/m1/reports/retro-summary.md"
      await Bun.write(path.join(dir, reportRel), "# retro\n")
      await store.recordRetroSummary({
        missionId: "m1",
        sessionId: "ses_retro_root",
        reportPath: reportRel,
      })
      expect(store.byAgentId("retro:m1")?.status).toBe("completed")
      expect(promptCalls).toHaveLength(1)
      expect(promptCalls[0]?.sessionId).toBe("ses_architect")
      expect(promptCalls[0]?.text).toContain("Retro review ready")
      expect(store.retroStatus("m1").status === "ok" && store.retroStatus("m1").architectNotified).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("retro_summary_record notifies lead when rollup is ready", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-registry-retro-lead-notify-"))
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
        agentId: OUTER_LEAD_ID,
        scope: "outer",
        profile: "lead",
        sessionId: "ses_lead",
        displayName: "Lead",
      })
      store.register({
        agentId: OUTER_ARCHITECT_ID,
        scope: "outer",
        profile: "architect",
        sessionId: "ses_architect",
        displayName: "Architect",
      })
      store.registerRetroAnalyst({
        missionId: "m1",
        sessionId: "ses_retro_root",
      })
      store.beginRetroRun("m1")
      const reportRel = ".gatehouse/trees/m1/reports/retro-summary.md"
      await Bun.write(path.join(dir, reportRel), "# retro\n")
      await store.recordRetroSummary({
        missionId: "m1",
        sessionId: "ses_retro_root",
        reportPath: reportRel,
      })
      expect(store.retroStatus("m1").architectSummarySubmitted).toBe(false)
      const afterRetro = await readBlogPublishedDocument(dir)
      expect(afterRetro.posts.map((entry) => entry.id)).toEqual(["m1:retro:summary"])

      const summaryRel = ".gatehouse/trees/m1/reports/architect-summary.md"
      await Bun.write(path.join(dir, summaryRel), "# architect summary\n")
      await store.recordArchitectRetroSummary({ missionId: "m1", reportPath: summaryRel })

      const afterArchitect = await readBlogPublishedDocument(dir)
      expect(afterArchitect.posts.map((entry) => entry.id)).toEqual([
        "m1:retro:summary",
        "m1:architect:summary",
      ])

      expect(store.retroStatus("m1").architectSummarySubmitted).toBe(true)
      expect(store.retroCompleteReadiness("m1").ready).toBe(true)
      expect(store.retroStatus("m1").leadRetroSummaryNotified).toBe(true)
      const leadPrompts = promptCalls.filter((call) => call.sessionId === "ses_lead")
      expect(leadPrompts).toHaveLength(1)
      expect(leadPrompts[0]?.text).toContain("Retro summaries ready")
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
        profile: "build",
        sessionId: "ses_root",
      })
      store.registerInnerNode({
        missionId: "m1",
        nodeId: "node-doc",
        profile: "build",
        sessionId: "ses_doc",
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

  test("lead can send_message to terminal node", async () => {
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
        profile: "build",
        sessionId: "ses_root",
      })
      seedActiveMissionRegistry(dir, "m1")
      seedTerminalPlan(dir, "m1", "node-root")

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

  test("submit_orchestration syncs inner nodes into registry.db", async () => {
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

      const bootstrap = submitOrchestrationTool(pluginInput)
      await bootstrap.execute({}, mockToolContext(dir, "ses_architect", "architect"))

      const apply = applySkillDomainsTool(pluginInput)
      await apply.execute(
        { assignments: { "node-doc": "docs" } },
        mockToolContext(dir, "ses_curator", "curator"),
      )

      const store = await RegistryStore.create({ directory: dir, client: mockClient })
      const inner = store.list({ scope: "inner", missionId: "core-example-smoke-v1" })
      expect(inner).toHaveLength(2)
      expect(inner.map((item) => item.nodeId).sort()).toEqual(["node-doc", "node-root"])
    } finally {
      stopSandboxOrchestration("core-example-smoke-v1")
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

  test("registers build profile with task allowed", async () => {
    const { applyGatehouseConfig } = await import("../src/setup/config.ts")
    const cfg = { profile: {} } as Record<string, unknown>
    await applyGatehouseConfig(cfg as never)
    const agents = cfg.agent as Record<string, Record<string, unknown>>
    const buildPermission = agents["build"]?.permission as Record<string, string>
    expect(agents["build"]?.mode).toBe("primary")
    expect(buildPermission.task).toBe("allow")
    expect(buildPermission.gatehouse_send_message).toBe("deny")
    expect(buildPermission.gatehouse_mission_info).toBe("allow")
    const buildTools = agents["build"]?.tools as Record<string, boolean>
    expect(buildTools.gatehouse_mission_info).toBeUndefined()
    expect(buildTools.gatehouse_send_message).toBe(false)
    expect(agents["build-root"]).toBeUndefined()
    expect(agents["build-coordinator"]).toBeUndefined()
    expect(agents["build-root-solo"]).toBeUndefined()
  })

  test("sets gatehouse_skill_extract_record for build-extract profile only", async () => {
    const { applyGatehouseConfig } = await import("../src/setup/config.ts")
    const cfg = { profile: {} } as Record<string, unknown>
    await applyGatehouseConfig(cfg as never)
    const agents = cfg.agent as Record<string, Record<string, unknown>>
    const extractPermission = agents["build-extract"]?.permission as Record<string, string>
    const buildPermission = agents["build"]?.permission as Record<string, string>
    expect(extractPermission.gatehouse_skill_extract_record).toBe("allow")
    expect(buildPermission.gatehouse_skill_extract_record).toBe("deny")
    const leadPermission = agents["lead"]?.permission as Record<string, string>
    expect(leadPermission.gatehouse_skill_extract_record).toBe("deny")
  })

  test("registers architect with submit_orchestration permissions", async () => {
    const { applyGatehouseConfig } = await import("../src/setup/config.ts")
    const cfg = { profile: {} } as Record<string, unknown>
    await applyGatehouseConfig(cfg as never)
    const agents = cfg.agent as Record<string, Record<string, unknown>>
    const permission = agents["architect"]?.permission as Record<string, string>
    expect(agents["architect"]?.mode).toBe("primary")
    expect(permission.task).toBe("deny")
    expect(permission.gatehouse_submit_orchestration).toBe("allow")
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
