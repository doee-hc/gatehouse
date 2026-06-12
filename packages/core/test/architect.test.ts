import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { loadArchitectPrompt } from "../src/prompt/architect.ts"

describe("loadArchitectPrompt", () => {
  test("loads bundled architect template without frontmatter", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-architect-prompt-"))
    try {
      const prompt = await loadArchitectPrompt(dir)
      expect(prompt).toContain("Architect")
      expect(prompt).not.toContain("name: architect")
      expect(prompt).toContain("architect-meta")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
