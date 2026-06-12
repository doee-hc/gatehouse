import { describe, expect, test } from "bun:test"
import {
  buildSessionKey,
  mentionsBot,
  normalizeGroupMessage,
  shouldHandleGroupMessage,
  textFromMessage,
} from "../src/onebot/inbound.ts"

const baseConfig = {
  requireAt: true,
  groupAllowList: [] as string[],
}

describe("qq-onebot inbound", () => {
  test("extracts text from segment array", () => {
    expect(
      textFromMessage([
        { type: "at", data: { qq: "111" } },
        { type: "text", data: { text: " hello" } },
      ]),
    ).toBe("hello")
  })

  test("extracts text from cq code string", () => {
    expect(textFromMessage("[CQ:at,qq=111] ping")).toBe("ping")
  })

  test("detects bot mention", () => {
    expect(
      mentionsBot(
        [
          { type: "at", data: { qq: "12345" } },
          { type: "text", data: { text: " hi" } },
        ],
        "12345",
      ),
    ).toBe(true)
  })

  test("normalizes group message when mentioned", () => {
    const message = normalizeGroupMessage(
      {
        post_type: "message",
        message_type: "group",
        group_id: "10001",
        user_id: "20002",
        message_id: "30003",
        self_id: "12345",
        message: [
          { type: "at", data: { qq: "12345" } },
          { type: "text", data: { text: " 你好" } },
        ],
      },
      baseConfig,
      "12345",
    )
    expect(message?.groupId).toBe("10001")
    expect(message?.userId).toBe("20002")
    expect(message?.text).toBe("你好")
    expect(message?.sessionKey).toBe(buildSessionKey("10001", "20002"))
  })

  test("ignores group message without mention when requireAt is true", () => {
    const message = normalizeGroupMessage(
      {
        post_type: "message",
        message_type: "group",
        group_id: "10001",
        user_id: "20002",
        message_id: "30003",
        self_id: "12345",
        message: "plain text",
      },
      baseConfig,
      "12345",
    )
    expect(message).toBeUndefined()
  })

  test("accepts all messages when requireAt is false", () => {
    const message = normalizeGroupMessage(
      {
        post_type: "message",
        message_type: "group",
        group_id: "10001",
        user_id: "20002",
        message_id: "30003",
        self_id: "12345",
        message: "plain text",
      },
      { ...baseConfig, requireAt: false },
      "12345",
    )
    expect(message?.text).toBe("plain text")
  })

  test("filters by group allow list", () => {
    expect(shouldHandleGroupMessage({ groupAllowList: ["10001"] }, "10001")).toBe(true)
    expect(shouldHandleGroupMessage({ groupAllowList: ["10001"] }, "99999")).toBe(false)
  })
})
