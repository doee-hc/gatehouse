import { describe, expect, test } from "bun:test"
import { chunkText } from "../../src/channels/text.ts"

describe("chunkText", () => {
  test("returns single chunk when under limit", () => {
    expect(chunkText("hello")).toEqual(["hello"])
  })

  test("splits long text", () => {
    const chunks = chunkText("a".repeat(2500), 2000)
    expect(chunks.length).toBe(2)
    expect(chunks.join("").length).toBe(2500)
  })
})
