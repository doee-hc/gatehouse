import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import path from "node:path"
import { bundledGatehouseTemplateRoot } from "../src/paths.ts"

const REQUIRED_EN_RELATIVES = [
  "lead/planning-skill/SKILL.md",
  "architect/meta-skill/SKILL.md",
  "architect/meta-skill/prompts/dispatch-root.md",
  "architect/meta-skill/prompts/watchdog-root-wake.md",
  "architect/meta-skill/prompts/watchdog-retro-record-wake.md",
  "architect/meta-skill/prompts/watchdog-skill-record-wake.md",
  "architect/meta-skill/prompts/retro-node-analysis.md",
  "architect/meta-skill/prompts/architect-summary.template.md",
  "architect/meta-skill/prompts/domain-skill-extract.md",
  "architect/retro-toolkit/SKILL.md",
  "architect/retro-toolkit/tools/_template/SKILL.md",
  "arbiter/meta-skill/SKILL.md",
  "curator/meta-skill/SKILL.md",
  "curator/meta-skill/prompts/skill-assign-kickoff.md",
  "skills/by-domain/README.md",
] as const

describe("english gatehouse templates", () => {
  test("en locale includes all required skill and prompt files", () => {
    const enRoot = bundledGatehouseTemplateRoot("en")
    const missing = REQUIRED_EN_RELATIVES.filter((relative) => !existsSync(path.join(enRoot, relative)))
    expect(missing).toEqual([])
  })
})
