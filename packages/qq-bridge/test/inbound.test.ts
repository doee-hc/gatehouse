import { describe, expect, test } from "bun:test"
import type { PrivateMessageEvent } from "qq-official-bot"
import { normalizePrivateMessage } from "../src/qq/inbound.ts"

describe("qq inbound", () => {
  test("extracts private text message", () => {
    const message = normalizePrivateMessage({
      id: "msg_1",
      message_id: "msg_1",
      user_id: "123456",
      raw_message: "  hello  ",
      message: [{ type: "text", data: { text: "hello" } }],
    } as PrivateMessageEvent)
    expect(message?.userId).toBe("123456")
    expect(message?.text).toBe("hello")
    expect(message?.messageType).toBe("text")
  })

  test("detects image segments", () => {
    const message = normalizePrivateMessage({
      id: "msg_2",
      message_id: "msg_2",
      user_id: "123456",
      message: [{ type: "image", data: { url: "https://example.com/a.png", name: "a.png" } }],
    } as PrivateMessageEvent)
    expect(message?.messageType).toBe("image")
    expect(message?.images[0]?.url).toBe("https://example.com/a.png")
  })

  test("detects unsupported media segments", () => {
    const message = normalizePrivateMessage({
      id: "msg_3",
      message_id: "msg_3",
      user_id: "123456",
      message: [{ type: "file", data: { url: "https://example.com/a.zip" } }],
    } as PrivateMessageEvent)
    expect(message?.messageType).toBe("media")
  })
})
