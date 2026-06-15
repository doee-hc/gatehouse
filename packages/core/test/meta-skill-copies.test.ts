import { describe, expect, test } from "bun:test"
import { lstatSync } from "node:fs"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { ensureMetaSkillCopies } from "../src/skills/meta-skill-copies.ts"
import { GATEHOUSE_META_SKILL_NAMES } from "../src/skills/constants.ts"
import { scaffoldGatehouse } from "../src/scaffold.ts"

describe("meta skill copies", () => {
  test("scaffold copies meta skills under .gatehouse/skills for OpenCode discovery", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-meta-copy-"))
    try {
      await scaffoldGatehouse(dir)

      for (const name of GATEHOUSE_META_SKILL_NAMES) {
        const copyPath = path.join(dir, ".gatehouse/skills", name)
        expect(lstatSync(copyPath).isSymbolicLink()).toBe(false)
        expect(await Bun.file(path.join(copyPath, "SKILL.md")).exists()).toBe(true)
        const localeText = await Bun.file(path.join(dir, ".gatehouse/zh/skills", name, "SKILL.md")).text()
        expect(await Bun.file(path.join(copyPath, "SKILL.md")).text()).toBe(localeText)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("does not replace existing copies created by user overrides", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-meta-copy-override-"))
    try {
      await scaffoldGatehouse(dir)

      const customDir = path.join(dir, ".gatehouse/skills/lead-meta")
      const marker = "# custom lead-meta override\n"
      await Bun.write(path.join(customDir, "SKILL.md"), marker)

      ensureMetaSkillCopies(dir)

      expect(lstatSync(customDir).isSymbolicLink()).toBe(false)
      expect(await Bun.file(path.join(customDir, "SKILL.md")).text()).toBe(marker)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("replaces legacy symlinks with copies", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-meta-copy-migrate-"))
    try {
      await scaffoldGatehouse(dir)

      const copyPath = path.join(dir, ".gatehouse/skills/lead-meta")
      await rm(copyPath, { recursive: true, force: true })
      await Bun.$`ln -s ${path.join("..", "zh", "skills", "lead-meta")} ${copyPath}`.quiet()

      ensureMetaSkillCopies(dir)

      expect(lstatSync(copyPath).isSymbolicLink()).toBe(false)
      const localeText = await Bun.file(path.join(dir, ".gatehouse/zh/skills/lead-meta/SKILL.md")).text()
      expect(await Bun.file(path.join(copyPath, "SKILL.md")).text()).toBe(localeText)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("copies from new locale when destination is missing after locale change", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-meta-copy-locale-"))
    try {
      await scaffoldGatehouse(dir)

      const configPath = path.join(dir, ".gatehouse/config.yaml")
      const config = await Bun.file(configPath).text()
      await Bun.write(configPath, config.replace(/^locale:\s*zh/m, "locale: en"))

      await rm(path.join(dir, ".gatehouse/skills/lead-meta"), { recursive: true, force: true })
      ensureMetaSkillCopies(dir, "en")

      const copyPath = path.join(dir, ".gatehouse/skills/lead-meta")
      const enText = await Bun.file(path.join(dir, ".gatehouse/en/skills/lead-meta/SKILL.md")).text()
      expect(await Bun.file(path.join(copyPath, "SKILL.md")).text()).toBe(enText)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
