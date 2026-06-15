import { describe, expect, test } from "bun:test"
import {
  hasDownloadableImages,
  inboundText,
  isUserTextMessage,
  unsupportedMediaReply,
} from "../src/ilink/inbound.ts"
import { MessageItemType, MessageType } from "../src/ilink/types.ts"

describe("inbound", () => {
  test("extracts text from user message", () => {
    const text = inboundText({
      message_type: MessageType.USER,
      item_list: [{ type: MessageItemType.TEXT, text_item: { text: "  hello  " } }],
    })
    expect(text).toBe("hello")
  })

  test("detects user text message", () => {
    expect(
      isUserTextMessage({
        message_type: MessageType.USER,
        item_list: [{ type: MessageItemType.TEXT, text_item: { text: "hi" } }],
      }),
    ).toBe(true)
  })

  test("detects downloadable image message", () => {
    const msg = {
      message_type: MessageType.USER,
      item_list: [
        {
          type: MessageItemType.IMAGE,
          image_item: { media: { encrypt_query_param: "param", aes_key: "abc" } },
        },
      ],
    }
    expect(hasDownloadableImages(msg)).toBe(true)
    expect(isUserTextMessage(msg)).toBe(true)
  })

  test("file still gets unsupported reply", () => {
    expect(
      unsupportedMediaReply({
        item_list: [{ type: MessageItemType.FILE }],
      }),
    ).toContain("Files")
  })
})
