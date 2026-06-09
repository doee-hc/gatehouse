import { describe, expect, test } from "bun:test"
import path from "node:path"
import {
  consumeOutboundQueue,
  enqueueOutboundFile,
  isImageAttachment,
  readOutboundQueue,
  resolveOutboundPath,
} from "../../src/channels/outbound.ts"

describe("outbound queue", () => {
  test("resolveOutboundPath rejects paths outside project", () => {
    const projectDir = path.join(import.meta.dir, ".tmp-outbound")
    expect(() => resolveOutboundPath(projectDir, "../../../etc/passwd")).toThrow()
  })

  test("enqueue and consume roundtrip", async () => {
    const projectDir = path.join(import.meta.dir, ".tmp-outbound-project")
    const filePath = path.join(projectDir, "pic.png")
    await Bun.write(filePath, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    await enqueueOutboundFile(projectDir, "sess_1", { path: filePath })
    const pending = await readOutboundQueue(projectDir, "sess_1")
    expect(pending).toHaveLength(1)
    expect(isImageAttachment(pending[0]!)).toBe(true)
    const consumed = await consumeOutboundQueue(projectDir, "sess_1")
    expect(consumed).toHaveLength(1)
    expect(await readOutboundQueue(projectDir, "sess_1")).toHaveLength(0)
  })
})
