import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import path from "node:path"
import { bundledGatehouseTemplateRoot } from "../src/paths.ts"

const REQUIRED_EN_RELATIVES = [
  "skills/lead-meta/SKILL.md",
  "skills/architect-meta/SKILL.md",
  "skills/curator-meta/SKILL.md",
  "skills/arbiter-meta/SKILL.md",
  "skills/retro-toolkit/SKILL.md",
  "skills/retro-toolkit/tools/_template/SKILL.md",
  "prompts/architect/watchdog-node-wake.md",
  "prompts/architect/watchdog-retro-record-wake.md",
  "prompts/architect/watchdog-skill-record-wake.md",
  "prompts/architect/retro-node-analysis.md",
  "prompts/architect/architect-summary.template.md",
  "prompts/architect/domain-skill-extract.md",
  "prompts/curator/skill-assign-kickoff.md",
  "lead/missions.template.yaml",
  "skills/by-domain/README.md",
] as const

describe("english gatehouse templates", () => {
  test("en locale includes all required skill and prompt files", () => {
    const enRoot = bundledGatehouseTemplateRoot("en")
    const missing = REQUIRED_EN_RELATIVES.filter((relative) => !existsSync(path.join(enRoot, relative)))
    expect(missing).toEqual([])
  })
})
