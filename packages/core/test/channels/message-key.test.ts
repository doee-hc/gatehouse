import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { isMessageKeyProcessed, rememberMessageKey } from "../../src/channels/store/state.ts"

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function tempStateDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-channels-key-"))
  tempDirs.push(dir)
  return dir
}

describe("message key dedup", () => {
  test("tracks recent string message keys", () => {
    const stateDir = tempStateDir()
    const userId = "ou_user"

    expect(isMessageKeyProcessed(stateDir, userId, "om_1")).toBe(false)
    rememberMessageKey(stateDir, userId, "om_1")
    expect(isMessageKeyProcessed(stateDir, userId, "om_1")).toBe(true)
    expect(isMessageKeyProcessed(stateDir, userId, "om_2")).toBe(false)
  })
})
