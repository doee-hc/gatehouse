import { describe, expect, test } from "bun:test"
import { inboundText, normalizeFeishuEvent, parseImageKey, parseTextContent, shouldHandleMessage } from "../src/feishu/inbound.ts"

describe("feishu inbound", () => {
  test("parses text content json", () => {
    expect(parseTextContent('{"text":"  hello  "}')).toBe("hello")
  })

  test("normalizes p2p text event", () => {
    const message = normalizeFeishuEvent({
      event_id: "evt_1",
      sender: { sender_type: "user", sender_id: { open_id: "ou_user" } },
      message: {
        chat_id: "oc_chat",
        chat_type: "p2p",
        message_id: "om_1",
        message_type: "text",
        content: '{"text":"hi"}',
      },
    })
    expect(message?.userId).toBe("ou_user")
    expect(message?.chatType).toBe("p2p")
    expect(inboundText(message!)).toBe("hi")
    expect(shouldHandleMessage(message!)).toBe(true)
  })

  test("parses image key from content", () => {
    expect(parseImageKey('{"image_key":"img_v2_abc"}')).toBe("img_v2_abc")
    expect(parseImageKey("not-json")).toBeUndefined()
  })

  test("ignores bot messages", () => {
    expect(
      normalizeFeishuEvent({
        sender: { sender_type: "app", sender_id: { open_id: "bot" } },
        message: {
          chat_id: "oc_chat",
          chat_type: "p2p",
          message_id: "om_2",
          message_type: "text",
          content: '{"text":"bot"}',
        },
      }),
    ).toBeUndefined()
  })
})
