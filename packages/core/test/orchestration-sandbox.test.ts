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
    expect(parsed.orchestrateSource).toContain('ctx.run("node-doc"')
    expect(parsed.scriptHash.length).toBe(64)
  })

  test("dryRun rejects run without brief for the same node", async () => {
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
  await ctx.run("leaf", { brief: { your_work: ["work"], not_your_job: [], acceptance_slice: ["done"] }, text: "go" })
  await ctx.run("coord", {
    text: ctx.template.workOrder("coord", { context: "review" }),
  })
}
`
    const result = await dryRunMissionScriptSource(source, "m1")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_MISSING_BRIEF")
    expect(result.message).toContain("coord")
  })

  test("dryRun rejects gatehouse_publish_blog references", async () => {
    const source = `
export const team = {
  mission_id: "m1",
  root: "maker",
  nodes: { maker: { parent: null, description: "make report" } },
}
export default async function orchestrate(ctx) {
  await ctx.run("maker", {
    brief: {
      your_work: ["publish via gatehouse_publish_blog"],
      acceptance_slice: ["done"],
    },
    text: "go",
  })
}
`
    const result = await dryRunMissionScriptSource(source, "m1")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_FORBIDDEN_PUBLISH")
  })

  test("dryRun rejects invalid orchestrate JavaScript syntax", async () => {
    const source = `
export const team = {
  mission_id: "m1",
  root: "leaf",
  nodes: { leaf: { parent: null, description: "leaf" } },
}
export default async function orchestrate(ctx) {
  await ctx.run("leaf", {
    brief: { your_work: ["work"], not_your_job: [], acceptance_slice: ["done"] },
    text: ctx.template.workOrder("leaf", {
      note: "call gatehouse_send_message(recipient="ai-writer", message="done")",
    }),
  })
}
`
    const result = await dryRunMissionScriptSource(source, "m1")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_INVALID_ORCHESTRATE_SYNTAX")
    expect(result.message).toContain("Unexpected identifier")
  })

  test("dryRun rejects missing orchestrate export", async () => {
    const source = `
export const team = {
  mission_id: "m1",
  root: "leaf",
  nodes: { leaf: { parent: null, description: "leaf" } },
}
`
    const result = await dryRunMissionScriptSource(source, "m1")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SCRIPT_MISSING_ORCHESTRATE")
  })

  test("dryRun rejects import declarations", async () => {
    const source = await Bun.file(importFsFixture).text()
    const result = await dryRunMissionScriptSource(source, "evil-m1")
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
