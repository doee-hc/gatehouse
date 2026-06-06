import { describe, expect, test } from "bun:test"
import path from "node:path"
import { stat } from "node:fs/promises"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { ensureSkillDomainDirs, skillDomainIdsFromAssignments } from "../src/skills/ensure-domain-dirs.ts"

describe("ensureSkillDomainDirs", () => {
  test("creates by-domain dirs and dedupes domain ids", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-ensure-domain-"))
    try {
      const ensured = await ensureSkillDomainDirs(dir, ["scan", " scan ", "scan", "mbist"])
      expect(ensured).toEqual(["scan", "mbist"])
      expect((await stat(path.join(dir, ".gatehouse/skills/by-domain/scan"))).isDirectory()).toBe(true)
      expect((await stat(path.join(dir, ".gatehouse/skills/by-domain/mbist"))).isDirectory()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("skillDomainIdsFromAssignments collects string values", () => {
    expect(
      skillDomainIdsFromAssignments({
        "node-a": "scan",
        "node-b": "  mbist ",
        "node-c": "",
        "node-d": 1,
      }),
    ).toEqual(["scan", "mbist"])
  })
})
