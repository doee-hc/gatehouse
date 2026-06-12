import { afterEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { deleteSession, shouldRetainInnerSessions } from "../src/session/client.ts"
import type { GatehouseClient } from "../src/session/client.ts"
import { deleteMissionSessions } from "../src/missions/lifecycle.ts"

const originalFetch = globalThis.fetch
const originalRetain = process.env.GATEHOUSE_RETAIN_INNER_SESSIONS
const originalHttpFlag = process.env.GATEHOUSE_USE_OPENCODE_HTTP

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalRetain === undefined) delete process.env.GATEHOUSE_RETAIN_INNER_SESSIONS
  else process.env.GATEHOUSE_RETAIN_INNER_SESSIONS = originalRetain
  if (originalHttpFlag === undefined) delete process.env.GATEHOUSE_USE_OPENCODE_HTTP
  else process.env.GATEHOUSE_USE_OPENCODE_HTTP = originalHttpFlag
})

describe("session delete", () => {
  test("deleteSession uses HTTP DELETE when OpenCode HTTP is ready", async () => {
    process.env.GATEHOUSE_USE_OPENCODE_HTTP = "1"
    const deleted: string[] = []
    const serverUrl = new URL("http://127.0.0.1:54097/")
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith("/global/health")) {
        return new Response(JSON.stringify({ healthy: true }), { status: 200 })
      }
      if (url.includes("/session/ses_inner") && input instanceof Request && input.method === "DELETE") {
        deleted.push("ses_inner")
        return new Response(null, { status: 200 })
      }
      return new Response(null, { status: 404 })
    }) as typeof fetch

    const mockClient: GatehouseClient = {
      session: {
        async create() {
          return { id: "ses_inner" }
        },
        async delete() {
          throw new Error("SDK delete should not run when HTTP succeeds")
        },
        async promptAsync() {
          return undefined
        },
        async messages() {
          return { data: [] }
        },
        async get() {
          return { data: {} }
        },
      },
    }

    const plugin = {
      directory: "/tmp/project",
      serverUrl,
      client: mockClient,
    } as unknown as PluginInput

    await deleteSession(mockClient, "/tmp/project", "ses_inner", plugin)
    expect(deleted).toEqual(["ses_inner"])
  })

  test("deleteMissionSessions retains sessions when GATEHOUSE_RETAIN_INNER_SESSIONS=1", async () => {
    process.env.GATEHOUSE_RETAIN_INNER_SESSIONS = "1"
    expect(shouldRetainInnerSessions()).toBe(true)

    const plugin = {
      directory: "/tmp/project",
      serverUrl: new URL("http://127.0.0.1:54098/"),
      client: {
        session: {
          async delete() {
            throw new Error("delete should not run when retain flag is set")
          },
        },
      },
    } as unknown as PluginInput

    const results = await deleteMissionSessions(plugin, ["ses_a", "ses_b"])
    expect(results).toEqual([
      { session_id: "ses_a", deleted: false, retained: true },
      { session_id: "ses_b", deleted: false, retained: true },
    ])
  })
})
