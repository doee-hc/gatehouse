import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { gatehouseProjectConfigPath } from "../src/gatehouse-config.ts"
import { resolveGatehouseContentPath } from "../src/paths.ts"
import { loadArchitectPrompt } from "../src/prompt/architect.ts"

describe("locale", () => {
  test("resolveGatehouseContentPath prefers locale-specific project files", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "gh-locale-path-"))
    try {
      const relative = "prompts/architect/dispatch-root.md"
      const localized = path.join(project, ".gatehouse", "en", relative)
      await mkdir(path.dirname(localized), { recursive: true })
      await writeFile(localized, "# English dispatch-root\n")

      await mkdir(path.join(project, ".gatehouse"), { recursive: true })
      await writeFile(gatehouseProjectConfigPath(project), "locale: en\n")

      expect(resolveGatehouseContentPath(project, relative)).toBe(localized)
    } finally {
      await rm(project, { recursive: true, force: true })
    }
  })

  test("loadArchitectPrompt uses English bundled template when locale is en", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "gh-locale-architect-"))
    try {
      await mkdir(path.join(project, ".gatehouse"), { recursive: true })
      await writeFile(gatehouseProjectConfigPath(project), "locale: en\n")

      const prompt = await loadArchitectPrompt(project)
      expect(prompt).toContain("Session opening")
      expect(prompt).not.toContain("会话开场")
    } finally {
      await rm(project, { recursive: true, force: true })
    }
  })
})
