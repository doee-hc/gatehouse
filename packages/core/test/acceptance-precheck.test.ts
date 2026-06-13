import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { criteriaFromStringList } from "../src/delivery/criteria.ts"
import { runAcceptanceSlicePrecheck } from "../src/execution/acceptance-precheck.ts"

describe("acceptance slice precheck", () => {
  test("criteriaFromStringList supports path string prefixes", () => {
    const criteria = criteriaFromStringList([
      "path: reports/a.html",
      "quality meets bar",
      "文件存在: docs/b.md",
    ])
    expect(criteria).toHaveLength(3)
    expect(criteria[0]?.check).toEqual({ kind: "path_exists", path: "reports/a.html" })
    expect(criteria[1]?.check).toEqual({ kind: "manual" })
    expect(criteria[2]?.check).toEqual({ kind: "path_exists", path: "docs/b.md" })
  })

  test("runAcceptanceSlicePrecheck blocks missing path_exists", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-acceptance-precheck-"))
    try {
      const result = await runAcceptanceSlicePrecheck(dir, ["path: missing.md", "manual ok"])
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain("missing.md")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("runAcceptanceSlicePrecheck passes when automated checks are met", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-acceptance-precheck-met-"))
    const rel = "out/file.txt"
    try {
      await Bun.write(path.join(dir, rel), "ok")
      const result = await runAcceptanceSlicePrecheck(dir, [`path: ${rel}`, "manual ok"])
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.precheck.filter((item) => item.status === "unmet")).toHaveLength(0)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
