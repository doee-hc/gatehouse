import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import {
  formatSkillDomainExistingSection,
  listSkillSlugsInDomain,
  loadDomainSkillExtractPrompt,
  resolveExecSkillDomain,
  skillDomainContextNote,
} from "../src/retro/skill-kickoff.ts"
import { parseTreeManifest } from "../src/tree/parse.ts"

const scaffoldScript = path.join(import.meta.dir, "../script/scaffold.ts")

describe("domain skill kickoff", () => {
  test("loadDomainSkillExtractPrompt renders placeholders", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-skill-kickoff-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      const prompt = await loadDomainSkillExtractPrompt(dir, {
        missionId: "m1",
        nodeId: "node-a",
        skillDomain: "scan",
      })
      expect(prompt).toContain("m1")
      expect(prompt).toContain("node-a")
      expect(prompt).toContain("scan")
      expect(prompt).toContain("by-domain/scan")
      expect(prompt).toContain("1k–3k token")
      expect(prompt).toContain("动词+名词")
      expect(prompt).toContain("## 约束")
      expect(prompt).toContain("不要")
      expect(prompt).toContain("批量 `mkdir`")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("loadDomainSkillExtractPrompt lists slugs only from the target skill_domain", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-skill-domain-slugs-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      const atpgDir = path.join(dir, ".gatehouse/skills/by-domain/atpg/generate-adk-db")
      const edtDir = path.join(dir, ".gatehouse/skills/by-domain/edt/run-internal-stuck-atpg")
      await Bun.$`mkdir -p ${atpgDir} ${edtDir}`.quiet()
      await Bun.write(path.join(atpgDir, "SKILL.md"), "---\nname: generate-adk-db\n---\n")
      await Bun.write(path.join(edtDir, "SKILL.md"), "---\nname: run-internal-stuck-atpg\n---\n")

      expect(await listSkillSlugsInDomain(dir, "atpg")).toEqual(["generate-adk-db"])
      expect(await listSkillSlugsInDomain(dir, "edt")).toEqual(["run-internal-stuck-atpg"])

      const prompt = await loadDomainSkillExtractPrompt(dir, {
        missionId: "m1",
        nodeId: "node-atpg",
        skillDomain: "atpg",
      })
      expect(prompt).toContain("generate-adk-db")
      expect(prompt).not.toContain("run-internal-stuck-atpg")
      expect(prompt).not.toContain("by-domain/edt")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("formatSkillDomainExistingSection omits mkdir guidance when empty", () => {
    const section = formatSkillDomainExistingSection(".gatehouse/skills/by-domain/scan", [])
    expect(section).toContain("尚无已有 skill")
    expect(section).not.toContain("mkdir")
  })

  test("skillDomainContextNote does not mention extraction during mission", () => {
    const note = skillDomainContextNote("mbist")
    expect(note).toContain("by-domain/mbist")
    expect(note).toContain("勿提炼 skill")
  })

  test("resolveExecSkillDomain uses manifest skill_domain only", () => {
    const manifest = parseTreeManifest(`
mission_id: m1
status: running
root_node: node-leaf
created_at: "2026-01-01T00:00:00Z"
nodes:
  node-leaf:
    session_id: s2
    parent: null
    skill_domain: scan
`)
    expect(resolveExecSkillDomain(manifest, "node-leaf", {})).toBe("scan")
    expect(resolveExecSkillDomain(manifest, "node-leaf", { briefDomainIds: ["dft"] })).toBe("scan")
  })

  test("resolveExecSkillDomain returns undefined without manifest skill_domain", () => {
    const manifest = parseTreeManifest(`
mission_id: m1
status: running
root_node: node-leaf
created_at: "2026-01-01T00:00:00Z"
nodes:
  node-leaf:
    session_id: s2
    parent: null
`)
    expect(resolveExecSkillDomain(manifest, "node-leaf", { briefDomainIds: ["dft"] })).toBeUndefined()
  })
})
