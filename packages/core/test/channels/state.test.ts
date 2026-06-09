import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import {
  getActiveAgentId,
  isMessageProcessed,
  rememberLastMessage,
  setActiveAgentId,
} from "../../src/channels/store/state.ts"

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function tempStateDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-channels-state-"))
  tempDirs.push(dir)
  return dir
}

describe("message dedup state", () => {
  test("tracks highest processed message id per user", () => {
    const stateDir = tempStateDir()
    const userId = "user-1"

    expect(isMessageProcessed(stateDir, userId, 1)).toBe(false)
    rememberLastMessage(stateDir, userId, 1)
    expect(isMessageProcessed(stateDir, userId, 1)).toBe(true)
    expect(isMessageProcessed(stateDir, userId, 2)).toBe(false)

    rememberLastMessage(stateDir, userId, 3)
    expect(isMessageProcessed(stateDir, userId, 2)).toBe(true)
    expect(isMessageProcessed(stateDir, userId, 3)).toBe(true)
    expect(isMessageProcessed(stateDir, userId, 4)).toBe(false)
  })

  test("preserves activeAgentId when recording message id", () => {
    const stateDir = tempStateDir()
    const userId = "user-1"

    setActiveAgentId(stateDir, userId, "inner:m-1:root")
    rememberLastMessage(stateDir, userId, 2)
    expect(getActiveAgentId(stateDir, userId)).toBe("inner:m-1:root")
  })

  test("defaults active agent to outer:lead", () => {
    const stateDir = tempStateDir()
    expect(getActiveAgentId(stateDir, "user-new")).toBe("outer:lead")
  })

  test("does not lower the high-water mark", () => {
    const stateDir = tempStateDir()
    const userId = "user-1"

    rememberLastMessage(stateDir, userId, 10)
    rememberLastMessage(stateDir, userId, 5)
    expect(isMessageProcessed(stateDir, userId, 9)).toBe(true)
    expect(isMessageProcessed(stateDir, userId, 10)).toBe(true)
    expect(isMessageProcessed(stateDir, userId, 11)).toBe(false)
  })
})
