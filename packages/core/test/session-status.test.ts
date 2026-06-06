import { describe, expect, test } from "bun:test"
import { sessionRuntimeStatus } from "../src/session/status.ts"

describe("sessionRuntimeStatus", () => {
  test("treats missing session as idle", () => {
    expect(sessionRuntimeStatus(new Map(), "ses_missing")).toBe("idle")
  })

  test("returns explicit busy status", () => {
    expect(sessionRuntimeStatus(new Map([["ses_a", "busy"]]), "ses_a")).toBe("busy")
  })
})
