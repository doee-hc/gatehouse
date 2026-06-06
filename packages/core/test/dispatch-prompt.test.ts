import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { readActiveMissionContract as readMissionBrief } from "../src/missions/contract.ts"
import { bulletList } from "../src/missions/parse.ts"
import { loadDispatchRootPrompt } from "../src/dispatch/prompt.ts"
import { copyExampleMission } from "./copy-example-mission.ts"

const scaffoldScript = path.join(import.meta.dir, "../script/scaffold.ts")

describe("dispatch prompt", () => {
  test("readMissionBrief reads active registry snapshot", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-mission-contract-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      await copyExampleMission(dir)
      const brief = await readMissionBrief(dir, "core-example-smoke-v1")
      expect(brief?.objective).toContain("packages/core")
      expect((brief?.done_when.length ?? 0) > 0).toBe(true)
      expect((brief?.must_not.length ?? 0) > 0).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("loadDispatchRootPrompt renders template placeholders", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-dispatch-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      await copyExampleMission(dir)
      const prompt = await loadDispatchRootPrompt(dir, "core-example-smoke-v1")
      expect(prompt).toContain("core-example-smoke-v1")
      expect(prompt).toContain("packages/core")
      expect(prompt).not.toContain("{{mission_id}}")
      expect(prompt).not.toContain("{{objective}}")
      expect(prompt).toContain("任务协调者")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("bulletList shows placeholder for empty list", () => {
    expect(bulletList([])).toBe("（无）")
    expect(bulletList(["a", "b"])).toBe("- a\n- b")
  })
})
