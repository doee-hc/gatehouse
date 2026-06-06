import { describe, expect, test } from "bun:test"
import { createSession } from "../src/session/client.ts"
import type { GatehouseClient } from "../src/session/client.ts"

describe("session models", () => {
  test("createSession forwards configured model into session.create body", async () => {
    let body: { model?: { providerID: string; id: string } } | undefined
    const mockClient: GatehouseClient = {
      session: {
        async create(input: unknown) {
          body = (input as { body?: { model?: { providerID: string; id: string } } }).body
          return { id: "ses_test" }
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

    await createSession(mockClient, "/tmp/project", {
      display_name: "node-root",
      profile: "build-coordinator",
      model: "test/coord-model",
    })

    expect(body?.model).toEqual({ providerID: "test", id: "coord-model" })
  })
})
