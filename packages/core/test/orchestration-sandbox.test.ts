import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { dryRunMissionScriptSource } from "../src/orchestration/script-validate.ts"
import { parseMissionScriptSource, MissionScriptParseError } from "../src/orchestration/script-parse.ts"
import { loadMissionScript } from "../src/orchestration/script-load.ts"

const smokeFixture = path.join(import.meta.dir, "fixtures/core-example-smoke-v1/mission.script.ts")
const importFsFixture = path.join(import.meta.dir, "fixtures/malicious-script/import-fs.mission.script.ts")

describe("mission script sandbox parse", () => {
  test("parseMissionScriptSource extracts team meta and orchestrate body", async () => {
    const source = await Bun.file(smokeFixture).text()
    const parsed = parseMissionScriptSource(source, "core-example-smoke-v1")
    expect(parsed.team.root).toBe("node-root")
    expect(parsed.meta?.name).toBe("core-example-smoke-v1")
    expect(parsed.orchestrateSource).toContain("ctx.waitFor(\"node-doc\"")
    expect(parsed.scriptHash.length).toBe(64)
  })

  test("dryRun rejects prompt(reply:true) without setBrief for the same node", () => {
    const source = `
export const team = {
  mission_id: "m1",
  root: "coord",
  nodes: {
    coord: { parent: null, description: "root" },
    leaf: { parent: "coord", description: "leaf" },
  },
}
export default async function orchestrate(ctx) {
  await ctx.setBrief("leaf", { your_work: ["work"], not_your_job: [], acceptance_slice: ["done"] })
  await ctx.prompt("leaf", { text: "go", reply: true })
  await ctx.waitFor("leaf", "complete")
  await ctx.prompt("coord", {
    text: ctx.template.workOrder("coord", { context: "review" }),
    reply: true,
  })
  await ctx.waitFor("coord", "complete")
}
`
    const result = dryRunMissionScriptSource(source, "m1")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_MISSING_BRIEF")
    expect(result.message).toContain("coord")
  })

  test("dryRun rejects import declarations", async () => {
    const source = await Bun.file(importFsFixture).text()
    const result = dryRunMissionScriptSource(source, "evil-m1")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_FORBIDDEN_IMPORT")
  })

  test("loadMissionScript rejects forbidden import on disk", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-sandbox-evil-"))
    try {
      const missionId = "evil-m1"
      const dest = path.join(dir, ".gatehouse/trees", missionId)
      await Bun.$`mkdir -p ${dest}`.quiet()
      await Bun.write(path.join(dest, "mission.script.ts"), Bun.file(importFsFixture))
      let thrown: unknown
      try {
        await loadMissionScript(dir, missionId)
      } catch (error) {
        thrown = error
      }
      expect(thrown instanceof MissionScriptParseError).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("loadMissionScript loads smoke fixture via parse path", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-sandbox-smoke-"))
    try {
      const missionId = "core-example-smoke-v1"
      const dest = path.join(dir, ".gatehouse/trees", missionId)
      await Bun.$`mkdir -p ${dest}`.quiet()
      await Bun.write(path.join(dest, "mission.script.ts"), Bun.file(smokeFixture))
      const script = await loadMissionScript(dir, missionId)
      expect(script?.orchestrateSource).toContain("node-doc")
      expect(script?.scriptHash.length).toBe(64)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
