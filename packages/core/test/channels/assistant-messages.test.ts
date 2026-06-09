import { describe, expect, test } from "bun:test"
import {
  collectDeliverableAssistantMessages,
  isDeliverableAssistantMessage,
} from "../../src/channels/opencode/assistant-messages.ts"

describe("assistant message delivery", () => {
  test("collects assistant messages after watermark", () => {
    const rows = [
      { info: { id: "m1", role: "assistant" }, parts: [{ type: "text", text: "first" }] },
      { info: { id: "m2", role: "user" }, parts: [{ type: "text", text: "hi" }] },
      { info: { id: "m3", role: "assistant" }, parts: [{ type: "text", text: "second" }] },
    ]
    expect(collectDeliverableAssistantMessages(rows, "m1")).toEqual([{ id: "m3", text: "second" }])
  })

  test("skips compaction and summary assistant rows", () => {
    const rows = [
      { info: { id: "m1", role: "assistant", summary: true }, parts: [{ type: "text", text: "sum" }] },
      { info: { id: "m2", role: "assistant", agent: "compaction" }, parts: [{ type: "text", text: "compact" }] },
      { info: { id: "m3", role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
    ]
    expect(collectDeliverableAssistantMessages(rows)).toEqual([{ id: "m3", text: "ok" }])
    expect(isDeliverableAssistantMessage(rows[0])).toBe(false)
    expect(isDeliverableAssistantMessage(rows[2])).toBe(true)
  })
})
