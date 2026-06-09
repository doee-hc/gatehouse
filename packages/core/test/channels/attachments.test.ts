import { describe, expect, test } from "bun:test"
import path from "node:path"
import {
  mimeFromContentType,
  mimeFromFilename,
  resolveAttachmentsDir,
  sanitizeFilename,
  saveAttachment,
} from "../../src/channels/attachments.ts"

describe("attachments", () => {
  test("sanitizeFilename strips path traversal", () => {
    expect(sanitizeFilename("../etc/passwd")).not.toContain("..")
    expect(sanitizeFilename("../etc/passwd")).not.toContain("/")
  })

  test("mimeFromFilename detects png", () => {
    expect(mimeFromFilename("photo.PNG")).toBe("image/png")
    expect(mimeFromContentType("image/jpeg; charset=binary")).toBe("image/jpeg")
  })

  test("saveAttachment writes under project attachments dir", async () => {
    const projectDir = path.join(import.meta.dir, ".tmp-attachments")
    const filepath = await saveAttachment(projectDir, "test.png", new Uint8Array([1, 2, 3]))
    expect(filepath.startsWith(resolveAttachmentsDir(projectDir))).toBe(true)
    expect(await Bun.file(filepath).exists()).toBe(true)
    await Bun.write(path.join(projectDir, ".cleanup"), "")
  })
})
