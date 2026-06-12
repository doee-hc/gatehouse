import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { installGatehouseClientGuard } from "../src/tui/client-guard.ts"
import { RegistryStore } from "../src/registry/store.ts"
import type { GatehouseClient } from "../src/session/client.ts"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"

function mockClient(): GatehouseClient {
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

describe("gatehouse tui client guard", () => {
  test("blocks mismatched outer agent and shows toast", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-client-guard-"))
    try {
      const store = await RegistryStore.create({ directory: dir, client: mockClient() })
      store.registerOuterSession({
        profile: "lead",
        sessionId: "ses_lead",
        projectRootSessionId: "ses_lead",
      })

      const toasts: Array<{ title?: string; message: string; variant?: string }> = []
      const session = {
        prompt: async (_args: { sessionID: string; agent?: string }) => ({ data: {} }),
        command: async (_args: { sessionID: string; agent?: string }) => ({ data: {} }),
        shell: async (_args: { sessionID: string; agent?: string }) => ({ data: {} }),
        promptAsync: async (_args: { sessionID: string; agent?: string }) => ({ data: {} }),
      }

      const api = {
        state: { path: { directory: dir } },
        ui: {
          toast(input: { title?: string; message: string; variant?: string }) {
            toasts.push(input)
          },
        },
        client: { session },
      } as unknown as TuiPluginApi

      installGatehouseClientGuard(api)

      const result = await session.prompt({ sessionID: "ses_lead", agent: "architect" })
      expect(result).toEqual({ error: { message: expect.stringContaining("cannot send as") } })
      expect(toasts).toHaveLength(1)
      expect(toasts[0]?.variant).toBe("error")
      expect(toasts[0]?.title).toBe("Gatehouse")
      expect(toasts[0]?.message.includes("cannot send as")).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("blocks creating a second lead session when one already exists", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-client-guard-create-"))
    try {
      const store = await RegistryStore.create({ directory: dir, client: mockClient() })
      store.registerOuterSession({
        profile: "lead",
        sessionId: "ses_lead",
        projectRootSessionId: "ses_lead",
      })

      const toasts: Array<{ message: string }> = []
      let created = false
      const session = {
        prompt: async () => ({ data: {} }),
        command: async () => ({ data: {} }),
        shell: async () => ({ data: {} }),
        promptAsync: async () => ({ data: {} }),
        create: async (_input?: unknown) => {
          created = true
          return { data: { id: "ses_new_lead" } }
        },
      }

      const api = {
        state: { path: { directory: dir } },
        ui: {
          toast(input: { message: string }) {
            toasts.push(input)
          },
        },
        client: { session },
      } as unknown as TuiPluginApi

      installGatehouseClientGuard(api)

      const result = await session.create({ body: { agent: "lead", title: "Lead" } })
      expect(created).toBe(false)
      expect(result).toEqual({ error: { message: expect.stringContaining("lead session already exists") } })
      expect(toasts).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("allows matching outer agent", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-client-guard-"))
    try {
      const store = await RegistryStore.create({ directory: dir, client: mockClient() })
      store.registerOuterSession({
        profile: "lead",
        sessionId: "ses_lead",
        projectRootSessionId: "ses_lead",
      })

      let called = false
      const session = {
        prompt: async (_args: { sessionID: string; agent?: string }) => {
          called = true
          return { data: { ok: true } }
        },
        command: async (_args: { sessionID: string; agent?: string }) => ({ data: {} }),
        shell: async (_args: { sessionID: string; agent?: string }) => ({ data: {} }),
        promptAsync: async (_args: { sessionID: string; agent?: string }) => ({ data: {} }),
      }

      const api = {
        state: { path: { directory: dir } },
        ui: { toast() {} },
        client: { session },
      } as unknown as TuiPluginApi

      installGatehouseClientGuard(api)

      const result = await session.prompt({ sessionID: "ses_lead", agent: "lead" })
      expect(called).toBe(true)
      expect(result).toEqual({ data: { ok: true } })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
