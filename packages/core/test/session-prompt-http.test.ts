import { afterEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { promptSession } from "../src/session/client.ts"
import type { GatehouseClient } from "../src/session/client.ts"

const originalFetch = globalThis.fetch
const originalHttpFlag = process.env.GATEHOUSE_USE_OPENCODE_HTTP

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalHttpFlag === undefined) delete process.env.GATEHOUSE_USE_OPENCODE_HTTP
  else process.env.GATEHOUSE_USE_OPENCODE_HTTP = originalHttpFlag
})

describe("promptSession HTTP path", () => {
  test("forwards profile as agent on prompt_async", async () => {
    process.env.GATEHOUSE_USE_OPENCODE_HTTP = "1"
    let promptBody: { agent?: string } | undefined
    const serverUrl = new URL("http://127.0.0.1:54096/")
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith("/global/health")) {
        return new Response(JSON.stringify({ healthy: true }), { status: 200 })
      }
      if (url.includes("/prompt_async")) {
        const raw =
          input instanceof Request
            ? await input.clone().text()
            : String(init?.body ?? "{}")
        promptBody = JSON.parse(raw) as { agent?: string }
        return new Response(null, { status: 200 })
      }
      return new Response(null, { status: 404 })
    }) as typeof fetch

    const mockClient: GatehouseClient = {
      session: {
        async create() {
          return { id: "ses_test" }
        },
        async promptAsync() {
          throw new Error("SDK promptAsync should not run when HTTP is ready")
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

    await promptSession(mockClient, "/tmp/project", "ses_architect", {
      profile: "architect",
      system: "architect system prompt",
      noReply: true,
    }, plugin)

    expect(promptBody?.agent).toBe("architect")
  })
})
