import { createCipheriv } from "node:crypto"
import { describe, expect, test } from "bun:test"
import { decryptAesEcb } from "../src/ilink/cdn/aes-ecb.ts"
import { parseAesKey } from "../src/ilink/cdn/download.ts"
import { buildCdnDownloadUrl } from "../src/ilink/cdn/cdn-url.ts"
import { mimeFromImageBytes } from "../src/ilink/media.ts"

describe("weixin cdn", () => {
  test("parseAesKey accepts raw 16-byte base64", () => {
    const key = Buffer.from("0123456789abcdef0123456789abcdef", "hex")
    expect(parseAesKey(key.toString("base64")).equals(key)).toBe(true)
  })

  test("parseAesKey accepts base64-encoded hex string", () => {
    const hex = "0123456789abcdef0123456789abcdef"
    const encoded = Buffer.from(hex, "ascii").toString("base64")
    expect(parseAesKey(encoded).equals(Buffer.from(hex, "hex"))).toBe(true)
  })

  test("decryptAesEcb roundtrip", () => {
    const key = Buffer.from("0123456789abcdef0123456789abcdef", "hex")
    const plaintext = Buffer.from("hello weixin image")
    const cipher = createCipheriv("aes-128-ecb", key, null)
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
    expect(decryptAesEcb(encrypted, key).equals(plaintext)).toBe(true)
  })

  test("buildCdnDownloadUrl encodes query param", () => {
    expect(buildCdnDownloadUrl("abc+def", "https://novac2c.cdn.weixin.qq.com/c2c")).toBe(
      "https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=abc%2Bdef",
    )
  })
})

describe("mimeFromImageBytes", () => {
  test("detects png signature", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    expect(mimeFromImageBytes(bytes).mime).toBe("image/png")
  })
})
