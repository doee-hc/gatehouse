import { describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { RegistryStore } from "../src/registry/store.ts"
import {
  assertOuterChatMessageAllowed,
  handleOuterChatMessage,
  outerChatMessageBlockReason,
} from "../src/registry/outer-chat-message.ts"
import { OUTER_LEAD_ID, OUTER_ARCHITECT_ID } from "../src/registry/types.ts"
import type { GatehouseClient } from "../src/session/client.ts"

function mockClientMinimal(options?: { onUpdate?: (sessionId: string, title: string) => void }): GatehouseClient {
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
      async update(input: unknown) {
        const body = (input as { path?: { id?: string }; body?: { title?: string } }).body
        const sessionId = (input as { path?: { id?: string } }).path?.id
        if (sessionId && body?.title) options?.onUpdate?.(sessionId, body.title)
      },
    },
  }
}

function writeProjectAgentName(dir: string, profile: "lead" | "architect", name: string) {
  const gatehouse = path.join(dir, ".gatehouse")
  mkdirSync(gatehouse, { recursive: true })
  writeFileSync(path.join(gatehouse, "config.yaml"), `agents:\n  ${profile}:\n    name: ${name}\n`)
}

describe("outer chat.message", () => {
  test("assertOuterChatMessageAllowed rejects mismatched outer agent on same session", () => {
    const owner = {
      agentId: OUTER_ARCHITECT_ID,
      scope: "outer" as const,
      profile: "architect",
      sessionId: "ses_architect",
      displayName: "Architect",
      status: "active" as const,
      createdAt: "",
      updatedAt: "",
    }
    const reason = outerChatMessageBlockReason(tmpdir(), owner, "ses_architect", "lead")
    expect(reason?.includes("registered as Architect")).toBe(true)
    expect(reason?.includes("cannot send as Lead")).toBe(true)
  })

  test("assertOuterChatMessageAllowed allows matching outer agent", () => {
    const owner = {
      agentId: OUTER_ARCHITECT_ID,
      scope: "outer" as const,
      profile: "architect",
      sessionId: "ses_architect",
      displayName: "Architect",
      status: "active" as const,
      createdAt: "",
      updatedAt: "",
    }
    assertOuterChatMessageAllowed(tmpdir(), owner, "ses_architect", "architect")
  })

  test("handleOuterChatMessage does not reassign lead when sending from architect session", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-outer-chat-"))
    try {
      const store = await RegistryStore.create({ directory: dir, client: mockClientMinimal() })
      store.registerOuterSession({
        profile: "lead",
        sessionId: "ses_lead",
        projectRootSessionId: "ses_lead",
      })
      store.registerOuterSession({
        profile: "architect",
        sessionId: "ses_architect",
        projectRootSessionId: "ses_lead",
      })

      let blocked = ""
      try {
        await handleOuterChatMessage(store, { sessionID: "ses_architect", agent: "lead" })
      } catch (error) {
        blocked = error instanceof Error ? error.message : String(error)
      }
      expect(blocked.includes("cannot send as Lead")).toBe(true)

      expect(store.byAgentId(OUTER_LEAD_ID)?.sessionId).toBe("ses_lead")
      expect(store.byAgentId(OUTER_ARCHITECT_ID)?.sessionId).toBe("ses_architect")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("handleOuterChatMessage registers first outer message on unclaimed session", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-outer-chat-"))
    try {
      const store = await RegistryStore.create({ directory: dir, client: mockClientMinimal() })

      await handleOuterChatMessage(store, { sessionID: "ses_new", agent: "lead" })

      expect(store.bySession("ses_new")?.profile).toBe("lead")
      expect(store.byAgentId(OUTER_LEAD_ID)?.sessionId).toBe("ses_new")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("handleOuterChatMessage sets lead session title from configured name", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-outer-chat-"))
    try {
      writeProjectAgentName(dir, "lead", "项目经理")
      const updates: Array<{ sessionId: string; title: string }> = []
      const store = await RegistryStore.create({
        directory: dir,
        client: mockClientMinimal({
          onUpdate: (sessionId, title) => updates.push({ sessionId, title }),
        }),
      })

      await handleOuterChatMessage(store, { sessionID: "ses_new", agent: "lead" })

      expect(updates).toEqual([{ sessionId: "ses_new", title: "项目经理" }])
      expect(store.byAgentId(OUTER_LEAD_ID)?.displayName).toBe("项目经理")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("handleOuterChatMessage rejects second lead session when lead already exists", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-outer-chat-"))
    try {
      const store = await RegistryStore.create({ directory: dir, client: mockClientMinimal() })
      store.registerOuterSession({
        profile: "lead",
        sessionId: "ses_lead",
        projectRootSessionId: "ses_lead",
      })

      let blocked = ""
      try {
        await handleOuterChatMessage(store, { sessionID: "ses_new", agent: "lead" })
      } catch (error) {
        blocked = error instanceof Error ? error.message : String(error)
      }
      expect(blocked.includes("lead session already exists")).toBe(true)
      expect(store.byAgentId(OUTER_LEAD_ID)?.sessionId).toBe("ses_lead")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("handleOuterChatMessage idempotently refreshes same outer agent on same session", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-outer-chat-"))
    try {
      const store = await RegistryStore.create({ directory: dir, client: mockClientMinimal() })
      store.registerOuterSession({
        profile: "architect",
        sessionId: "ses_architect",
        projectRootSessionId: "ses_lead",
      })

      await handleOuterChatMessage(store, { sessionID: "ses_architect", agent: "architect" })

      expect(store.byAgentId(OUTER_ARCHITECT_ID)?.sessionId).toBe("ses_architect")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
