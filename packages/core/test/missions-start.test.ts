import { expect, test } from "bun:test"
import { validateMissionStartEntry } from "../src/missions/start.ts"
import type { MissionEntry } from "../src/missions/parse.ts"

function entry(overrides: Partial<MissionEntry> = {}): MissionEntry {
  return {
    id: "m1",
    status: "queued",
    objective: "demo",
    done_when: ["deliverable ready"],
    must_not: [],
    ...overrides,
  }
}

test("validateMissionStartEntry rejects duplicate done_when entries", () => {
  let message = ""
  try {
    validateMissionStartEntry(
      entry({
        done_when: [
          "文件存在: docs/foo.md",
          "文件存在: docs/foo.md",
        ],
      }),
    )
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  expect(message).toContain("duplicate done_when")
})

test("validateMissionStartEntry rejects empty done_when entries", () => {
  let message = ""
  try {
    validateMissionStartEntry(entry({ done_when: ["ok", "   "] }))
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  expect(message).toContain("empty done_when")
})
