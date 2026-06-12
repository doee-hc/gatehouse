import { afterEach, beforeEach, expect, test } from "bun:test"
import path from "node:path"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import type { GatehouseClient } from "../src/session/client.ts"
import { dumpOuterSessionsForDebug } from "../src/session/debug-dump.ts"
import { dumpMissionSessionsForDebug } from "../src/session/dump-mission-sessions.ts"
import { getRegistryStore } from "../src/registry/context.ts"
import type { PluginInput } from "@opencode-ai/plugin"

let dir: string

function mockClient(): GatehouseClient {
  return {
    session: {
      async create() {
        return { id: "unused" }
      },
      async messages(input: { path: { id: string } }) {
        return {
          data: [
            {
              info: { role: "user", id: "u1", time: { created: 1000 } },
              parts: [{ type: "text", text: `msg from ${input.path.id}` }],
            },
          ],
        }
      },
      async get(input: { path: { id: string } }) {
        return { data: { created: 1000, updated: 2000, id: input.path.id } }
      },
      async promptAsync() {
        return undefined
      },
    },
  }
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "gh-debug-dump-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

test("dumpOuterSessionsForDebug writes all registered outer sessions", async () => {
  await mkdir(path.join(dir, ".gatehouse"), { recursive: true })

  const pluginInput = { directory: dir, client: mockClient() } as unknown as PluginInput
  const store = await getRegistryStore(pluginInput)
  for (const profile of ["lead", "architect", "curator", "arbiter"] as const) {
    store.registerOuterSession({ sessionId: `ses_${profile}`, profile })
  }

  const result = await dumpOuterSessionsForDebug({
    client: mockClient(),
    projectDirectory: dir,
    missionId: "m-debug",
    registry: store,
  })
  expect(result.outer_count).toBe(4)

  const index = JSON.parse(
    await Bun.file(path.join(dir, ".gatehouse/internal/debug/sessions/m-debug/index.json")).text(),
  ) as { outer: { profile: string }[] }
  expect(index.outer).toHaveLength(4)

  const leadMessages = JSON.parse(
    await Bun.file(
      path.join(dir, ".gatehouse/internal/debug/sessions/m-debug/outer/lead/messages.json"),
    ).text(),
  ) as { profile: string }
  expect(leadMessages.profile).toBe("lead")
})

test("dumpMissionSessionsForDebug outer-only skips inner manifest requirement", async () => {
  await mkdir(path.join(dir, ".gatehouse"), { recursive: true })

  const pluginInput = { directory: dir, client: mockClient() } as unknown as PluginInput
  const store = await getRegistryStore(pluginInput)
  store.registerOuterSession({ sessionId: "ses_lead", profile: "lead" })

  const result = await dumpMissionSessionsForDebug({
    client: mockClient(),
    projectDirectory: dir,
    missionId: "m-outer-only",
    registry: store,
    scope: "outer",
  })
  expect(result.inner).toBeUndefined()
  expect(result.outer?.outer_count).toBe(1)
})
