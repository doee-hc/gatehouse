import { describe, expect, test } from "bun:test"
import { missionScriptErrorHint } from "../src/orchestration/script-error-hints.ts"

describe("missionScriptErrorHint", () => {
  test("returns hint for common architect failure codes", () => {
    expect(missionScriptErrorHint("SCRIPT_SERIAL_TRACK_BLOCK")).toContain("ctx.parallel")
    expect(missionScriptErrorHint("SCRIPT_MISSING_BRIEF")).toContain("brief:")
  })

  test("returns undefined for unknown codes", () => {
    expect(missionScriptErrorHint("SCRIPT_UNKNOWN_CODE")).toBeUndefined()
  })
})
