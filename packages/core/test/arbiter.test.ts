import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { getPermissionArbiter } from "../src/arbiter/arbiter.ts"
import { permissionCaseFromEvent } from "../src/arbiter/queue.ts"
import { getRegistryStore } from "../src/registry/context.ts"
import { RegistryStore } from "../src/registry/store.ts"
import { OUTER_ARBITER_ID, ARBITER_OPENCODE } from "../src/registry/types.ts"
import type { GatehouseClient } from "../src/session/client.ts"
import { inspectorDecideTool, inspectorQueueTool } from "../src/tools/inspector.ts"

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

function toolOutput(result: Awaited<ReturnType<ReturnType<typeof inspectorDecideTool>["execute"]>>) {
  return typeof result === "string" ? result : result.output
}

describe("permission arbiter", () => {
  test("permissionCaseFromEvent parses permission.asked payload", () => {
    const item = permissionCaseFromEvent({
      id: "per_test",
      sessionID: "ses_exec",
      permission: "bash",
      patterns: ["git status"],
      metadata: { command: "git status" },
      always: ["git status"],
      tool: { messageID: "msg_1", callID: "call_1" },
    })
    expect(item?.requestId).toBe("per_test")
    expect(item?.sessionId).toBe("ses_exec")
    expect(item?.permission).toBe("bash")
  })

  test("ensureArbiterSession recreates arbiter when registry session was deleted", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-jiucha-stale-"))
    try {
      const mockClient: GatehouseClient = {
        session: {
          async create() {
            return { id: "ses_arbiter_new" }
          },
          async promptAsync() {},
          async messages() {
            return { data: [] }
          },
          async get(input: unknown) {
            const record = input as { path: { id: string } }
            if (record.path.id === "ses_arbiter_stale") return {}
            return { data: { id: record.path.id } }
          },
        },
      }
      const store = await RegistryStore.create({ directory: dir, client: mockClient })
      store.register({
        agentId: OUTER_ARBITER_ID,
        scope: "outer",
        profile: "arbiter",
        sessionId: "ses_arbiter_stale",
        displayName: "Arbiter",
      })
      const ensured = await store.ensureArbiterSession("ses_root")
      expect(ensured.createdSession).toBe(true)
      expect(ensured.agent.sessionId).toBe("ses_arbiter_new")
      expect(store.byProfile("arbiter", "outer")?.sessionId).toBe("ses_arbiter_new")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("ensureArbiterSession registers outer arbiter", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-jiucha-"))
    try {
      const mockClient: GatehouseClient = {
        session: {
          async create() {
            return { id: "ses_arbiter" }
          },
          async promptAsync() {},
          async messages() {
            return { data: [] }
          },
          async get() {
            return { data: {} }
          },
        },
      }
      const store = await RegistryStore.create({ directory: dir, client: mockClient })
      const ensured = await store.ensureArbiterSession("ses_root")
      expect(ensured.agent.sessionId).toBe("ses_arbiter")
      expect(ensured.agent.agentId).toBe(OUTER_ARBITER_ID)
      expect(store.byProfile("arbiter", "outer")?.displayName).toBe("Arbiter")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("replyPermission succeeds when list is empty but reply resolves request", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-jiucha-reply-no-list-"))
    try {
      const pending = new Set(["per_live"])
      const pluginInput = {
        directory: dir,
        worktree: dir,
        serverUrl: new URL("http://localhost:4096/"),
        client: {
          session: {
            async get() {
              return { data: { directory: dir } }
            },
          },
          permission: {
            async respond(input: { permissionID: string }) {
              if (!pending.has(input.permissionID)) throw new Error("NotFound")
              pending.delete(input.permissionID)
              return { data: true }
            },
            async reply(input: { requestID: string }) {
              if (!pending.has(input.requestID)) throw new Error("NotFound")
              pending.delete(input.requestID)
              return { data: true }
            },
            async list() {
              return { data: [] }
            },
          },
        },
      } as unknown as PluginInput

      const { replyPermission } = await import("../src/permission/client.ts")
      await replyPermission(pluginInput, {
        requestId: "per_live",
        sessionId: "ses_exec",
        reply: "once",
      })
      expect(pending.size).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("replyPermission prefers session-scoped respond for routing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-jiucha-reply-session-"))
    try {
      const respondCalls: { sessionID: string; permissionID: string; response?: string }[] = []
      const replyCalls: unknown[] = []
      const pluginInput = {
        directory: dir,
        worktree: dir,
        serverUrl: new URL("http://localhost:4096/"),
        client: {
          session: {
            async get() {
              return { data: { directory: dir } }
            },
          },
          permission: {
            async respond(input: { sessionID: string; permissionID: string; response?: string }) {
              respondCalls.push(input)
              return { data: true }
            },
            async reply(input: unknown) {
              replyCalls.push(input)
              return { data: true }
            },
            async list() {
              return { data: [] }
            },
          },
        },
      } as unknown as PluginInput

      const { replyPermission } = await import("../src/permission/client.ts")
      await replyPermission(pluginInput, {
        requestId: "per_session",
        sessionId: "ses_architect",
        reply: "always",
      })
      expect(respondCalls).toEqual([
        { sessionID: "ses_architect", permissionID: "per_session", response: "always" },
      ])
      expect(replyCalls).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("replyPermission routes via workspace when session directory is outside project", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-jiucha-reply-workspace-"))
    try {
      const replyCalls: { requestID: string; workspace?: string; directory?: string }[] = []
      const pluginInput = {
        directory: dir,
        worktree: dir,
        serverUrl: new URL("http://localhost:4096/"),
        client: {
          session: {
            async get() {
              return { data: { directory: "/", workspaceID: "wsp_apo" } }
            },
          },
          permission: {
            async respond() {
              throw new Error("permission request per_ws not found", { cause: { status: 404 } })
            },
            async reply(input: { requestID: string; workspace?: string; directory?: string }) {
              replyCalls.push(input)
              if (input.workspace !== "wsp_apo") {
                throw new Error("permission request per_ws not found", { cause: { status: 404 } })
              }
              return { data: true }
            },
            async list() {
              return { data: [] }
            },
          },
        },
      } as unknown as PluginInput

      const { replyPermission } = await import("../src/permission/client.ts")
      await replyPermission(pluginInput, {
        requestId: "per_ws",
        sessionId: "ses_architect",
        reply: "once",
      })
      expect(replyCalls[0]?.workspace).toBe("wsp_apo")
      expect(replyCalls[0]?.directory).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("applyDecision clears stale queue entry when OpenCode returns not pending", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-jiucha-stale-decide-"))
    try {
      const pluginInput = {
        directory: dir,
        worktree: dir,
        serverUrl: new URL("http://localhost:4096/"),
        client: {
          session: {
            async get() {
              return { data: { directory: dir } }
            },
          },
          permission: {
            async respond() {
              throw new Error("POST http://localhost:4096/session/ses_exec/permissions/per_stale → 404", {
                cause: { status: 404 },
              })
            },
            async reply() {
              throw new Error("POST http://localhost:4096/permission/per_stale/reply → 404", {
                cause: { status: 404 },
              })
            },
            async list() {
              return { data: [] }
            },
          },
        },
      } as unknown as PluginInput
      const store = await RegistryStore.create({ directory: dir, client: pluginInput.client as GatehouseClient })
      const arbiter = await getPermissionArbiter(pluginInput, store)
      arbiter.queue.upsert({
        requestId: "per_stale",
        sessionId: "ses_exec",
        permission: "external_directory",
        patterns: ["/tmp/*"],
        metadata: {},
        always: [],
        directory: dir,
        askedAt: new Date().toISOString(),
      })
      expect(arbiter.queue.get("per_stale") !== undefined).toBe(true)
      let error: unknown
      await arbiter
        .applyDecision({
          arbiterSessionId: "ses_arbiter",
          requestId: "per_stale",
          reply: "once",
          reason: "测试",
          toolDirectory: dir,
        })
        .catch((err) => {
          error = err
        })
      expect(error instanceof Error && error.message.includes("未能通过 Gatehouse 路由")).toBe(true)
      expect(arbiter.queue.get("per_stale")).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("replyPermission fails when server still lists request as pending", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-jiucha-reply-pending-"))
    try {
      const pluginInput = {
        directory: dir,
        serverUrl: new URL("http://localhost:4096/"),
        client: {
          session: {
            async get() {
              return { data: { directory: dir } }
            },
          },
          permission: {
            async respond() {
              return { data: true }
            },
            async reply() {
              return { data: true }
            },
            async list() {
              return {
                data: [
                  {
                    id: "per_stuck",
                    sessionID: "ses_exec",
                    permission: "edit",
                    patterns: [],
                    metadata: {},
                    always: [],
                  },
                ],
              }
            },
          },
        },
      } as unknown as PluginInput

      const { replyPermission } = await import("../src/permission/client.ts")
      let error: unknown
      await replyPermission(pluginInput, {
        requestId: "per_stuck",
        sessionId: "ses_exec",
        reply: "once",
      }).catch((err) => {
        error = err
      })
      expect(error instanceof Error && error.message.includes("ask UI may still be waiting")).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("applyDecision replies via v1 session permission endpoint when respond is unavailable", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-jiucha-v1-perm-"))
    try {
      const replyCalls: { sessionId: string; permissionId: string; response?: string }[] = []
      const pending = new Set(["per_v1"])
      const mockClient: GatehouseClient & {
        permission: {
          list(): Promise<{ data: unknown[] }>
        }
        postSessionIdPermissionsPermissionId(input: {
          path: { id: string; permissionID: string }
          body?: { response?: string }
        }): Promise<unknown>
      } = {
        session: {
          async create() {
            return { id: "ses_arbiter" }
          },
          async promptAsync() {},
          async messages() {
            return { data: [] }
          },
          async get(input: unknown) {
            const record = input as { path: { id: string } }
            return { data: { id: record.path.id, directory: dir } }
          },
        },
        permission: {
          async list() {
            return {
              data: [...pending].map((id) => ({
                id,
                sessionID: "ses_exec",
                permission: "edit",
                patterns: [],
                metadata: {},
                always: [],
              })),
            }
          },
        },
        async postSessionIdPermissionsPermissionId(input) {
          replyCalls.push({
            sessionId: input.path.id,
            permissionId: input.path.permissionID,
            response: input.body?.response,
          })
          pending.delete(input.path.permissionID)
          return { data: true }
        },
      }

      const pluginInput = {
        directory: dir,
        client: mockClient,
        serverUrl: new URL("http://localhost:4096/"),
      } as unknown as PluginInput
      const store = await getRegistryStore(pluginInput)
      await store.ensureArbiterSession()
      const arbiter = await getPermissionArbiter(pluginInput, store)

      await arbiter.handlePermissionAsked({
        id: "per_v1",
        sessionID: "ses_exec",
        permission: "edit",
        patterns: ["src/foo.ts"],
        metadata: { filepath: "src/foo.ts" },
        always: [],
      })

      await arbiter.applyDecision({
        arbiterSessionId: "ses_arbiter",
        requestId: "per_v1",
        reply: "once",
        reason: "允许一次",
        toolDirectory: dir,
      })

      expect(replyCalls).toEqual([
        { sessionId: "ses_exec", permissionId: "per_v1", response: "once" },
      ])
      expect(arbiter.queue.get("per_v1")).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("handlePermissionAsked skips arbiter prompt when team not initialized", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-jiucha-no-init-"))
    try {
      const promptCalls: { sessionId: string; text: string }[] = []
      const mockClient: GatehouseClient = {
        session: {
          async create() {
            return { id: "ses_arbiter" }
          },
          async promptAsync(input: unknown) {
            const record = input as { path: { id: string }; body: { parts: { text: string }[] } }
            promptCalls.push({ sessionId: record.path.id, text: record.body.parts[0]?.text ?? "" })
          },
          async messages() {
            return { data: [] }
          },
          async get() {
            return { data: {} }
          },
        },
      }
      const pluginInput = { directory: dir, client: mockClient } as unknown as PluginInput
      const store = await getRegistryStore(pluginInput)
      const arbiter = await getPermissionArbiter(pluginInput, store)

      await arbiter.handlePermissionAsked({
        id: "per_uninit",
        sessionID: "ses_exec",
        permission: "edit",
        patterns: ["src/foo.ts"],
        metadata: { filepath: "src/foo.ts" },
        always: [],
      })

      expect(promptCalls).toHaveLength(0)
      expect(arbiter.queue.get("per_uninit")?.requestId).toBe("per_uninit")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("handlePermissionAsked wakes arbiter and decide replies via client", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-jiucha-arbiter-"))
    try {
      const respondCalls: { sessionID: string; permissionID: string; response?: string }[] = []
      const replyCalls: { requestID: string; reply?: string; message?: string }[] = []
      const promptCalls: { sessionId: string; text: string }[] = []
      const pending = new Set(["per_1"])
      const mockClient: GatehouseClient & {
        permission: {
          respond(input: { sessionID: string; permissionID: string; response?: string }): Promise<unknown>
          reply(input: { requestID: string; directory?: string; reply?: string; message?: string }): Promise<unknown>
          list(input?: { directory?: string }): Promise<{ data: unknown[] }>
        }
      } = {
        session: {
          async create() {
            return { id: "ses_arbiter" }
          },
          async promptAsync(input: unknown) {
            const record = input as { path: { id: string }; body: { parts: { text: string }[] } }
            promptCalls.push({ sessionId: record.path.id, text: record.body.parts[0]?.text ?? "" })
          },
          async messages() {
            return { data: [] }
          },
          async get() {
            return { data: { directory: dir } }
          },
        },
        permission: {
          async respond(input) {
            pending.delete(input.permissionID)
            respondCalls.push(input)
            return { data: true }
          },
          async reply(input) {
            pending.delete(input.requestID)
            replyCalls.push(input)
            return { data: true }
          },
          async list() {
            return {
              data: [...pending].map((id) => ({
                id,
                sessionID: "ses_exec",
                permission: "edit",
                patterns: [],
                metadata: {},
                always: [],
              })),
            }
          },
        },
      }

      const pluginInput = { directory: dir, client: mockClient, serverUrl: new URL("http://localhost:4096/") } as unknown as PluginInput
      const store = await getRegistryStore(pluginInput)
      await store.ensureArbiterSession()
      const arbiter = await getPermissionArbiter(pluginInput, store)

      await arbiter.handlePermissionAsked({
        id: "per_1",
        sessionID: "ses_exec",
        permission: "edit",
        patterns: ["src/foo.ts"],
        metadata: { filepath: "src/foo.ts" },
        always: [],
      })

      expect(promptCalls.filter((call) => call.text.includes("[Gatehouse 权限案卷]"))).toHaveLength(1)
      expect(promptCalls.at(-1)?.sessionId).toBe("ses_arbiter")
      expect(promptCalls.at(-1)?.text).toContain("per_1")

      await arbiter.applyDecision({
        arbiterSessionId: "ses_arbiter",
        requestId: "per_1",
        reply: "once",
        reason: "只读范围内编辑，允许一次",
        toolDirectory: dir,
      })

      expect(respondCalls).toEqual([
        { sessionID: "ses_exec", permissionID: "per_1", response: "once" },
      ])
      expect(replyCalls).toEqual([])

      const auditPath = path.join(dir, ".gatehouse/arbiter/decisions.jsonl")
      expect(await Bun.file(auditPath).exists()).toBe(true)
      expect(await Bun.file(auditPath).text()).toContain("per_1")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("gatehouse_inspector tools enforce arbiter profile caller", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-jiucha-tools-"))
    try {
      const pending = new Set<string>()
      const mockClient: GatehouseClient & {
        permission: {
          respond(input: { permissionID: string }): Promise<unknown>
          reply(input: { requestID: string }): Promise<unknown>
          list(): Promise<{ data: unknown[] }>
        }
      } = {
        session: {
          async create() {
            return { id: "ses_arbiter" }
          },
          async promptAsync() {},
          async messages() {
            return { data: [] }
          },
          async get() {
            return { data: { directory: dir } }
          },
        },
        permission: {
          async respond(input) {
            pending.delete(input.permissionID)
            return { data: true }
          },
          async reply(input) {
            pending.delete(input.requestID)
            return { data: true }
          },
          async list() {
            return {
              data: [...pending].map((id) => ({
                id,
                sessionID: "ses_exec",
                permission: "read",
                patterns: [],
                metadata: {},
                always: [],
              })),
            }
          },
        },
      }

      const pluginInput = { directory: dir, client: mockClient, serverUrl: new URL("http://localhost:4096/") } as unknown as PluginInput
      const queue = inspectorQueueTool(pluginInput)
      const decide = inspectorDecideTool(pluginInput)

      const forbidden = toolOutput(await queue.execute({}, mockToolContext(dir, "ses_exec", "build")))
      expect(forbidden).toContain("FORBIDDEN")

      const store = await getRegistryStore(pluginInput)
      await store.ensureArbiterSession()
      const arbiter = await getPermissionArbiter(pluginInput, store)

      await arbiter.handlePermissionAsked({
        id: "per_2",
        sessionID: "ses_exec",
        permission: "read",
        patterns: ["README.md"],
        metadata: {},
        always: [],
      })
      pending.add("per_2")

      const listed = toolOutput(await queue.execute({}, mockToolContext(dir, "ses_arbiter", ARBITER_OPENCODE)))
      expect(listed).toContain("per_2")

      const decided = toolOutput(
        await decide.execute(
          { request_id: "per_2", reply: "once", reason: "读取 README 合理" },
          mockToolContext(dir, "ses_arbiter", ARBITER_OPENCODE),
        ),
      )
      expect(decided).toContain("per_2")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("applyGatehouseConfig arbiter", () => {
  test("registers arbiter profile with inspector tools", async () => {
    const { applyGatehouseConfig } = await import("../src/setup/config.ts")
    const cfg = { profile: {} } as Record<string, unknown>
    await applyGatehouseConfig(cfg as never)
    const agents = cfg.agent as Record<string, Record<string, unknown>>
    const permission = agents["arbiter"]?.permission as Record<string, string>
    expect(agents["arbiter"]?.mode).toBe("primary")
    expect(permission.gatehouse_inspector_decide).toBe("allow")
    expect(permission.gatehouse_inspector_queue).toBe("allow")
    expect(permission.shell).toBe("deny")
  })
})
