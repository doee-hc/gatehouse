import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { runGatehouseDoctor } from "../src/cli/doctor.ts"
import {
  compareSemver,
  parseSemver,
  satisfiesOpencodeVersion,
} from "../src/setup/opencode-version.ts"
import { registerGatehouseInGlobalOpencodeConfig } from "../src/setup/project.ts"
import { ensureGlobalGatehouseConfig } from "../src/gatehouse-config.ts"

describe("opencode version", () => {
  test("parseSemver and compareSemver", () => {
    expect(parseSemver("1.16.2")).toEqual({ major: 1, minor: 16, patch: 2 })
    expect(compareSemver("1.14.40", "1.16.0")).toBe(-1)
    expect(compareSemver("1.16.0", "1.17.0")).toBe(-1)
  })

  test("satisfiesOpencodeVersion accepts supported range", () => {
    expect(satisfiesOpencodeVersion("1.16.0").ok).toBe(true)
    expect(satisfiesOpencodeVersion("1.14.40").ok).toBe(true)
    expect(satisfiesOpencodeVersion("1.13.0").ok).toBe(false)
    expect(satisfiesOpencodeVersion("1.17.0").ok).toBe(false)
  })
})

describe("gatehouse doctor", () => {
  async function withIsolatedEnv<T>(
    run: (dirs: { globalOpencode: string; globalGatehouse: string; project: string }) => Promise<T>,
  ) {
    const globalOpencode = await mkdtemp(path.join(tmpdir(), "gh-doc-oc-"))
    const globalGatehouse = await mkdtemp(path.join(tmpdir(), "gh-doc-gh-"))
    const project = await mkdtemp(path.join(tmpdir(), "gh-doc-proj-"))
    const prevOc = process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR
    const prevGh = process.env.GATEHOUSE_GLOBAL_CONFIG_DIR
    process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR = globalOpencode
    process.env.GATEHOUSE_GLOBAL_CONFIG_DIR = globalGatehouse
    try {
      return await run({ globalOpencode, globalGatehouse, project })
    } finally {
      if (prevOc === undefined) delete process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR
      else process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR = prevOc
      if (prevGh === undefined) delete process.env.GATEHOUSE_GLOBAL_CONFIG_DIR
      else process.env.GATEHOUSE_GLOBAL_CONFIG_DIR = prevGh
      await rm(globalOpencode, { recursive: true, force: true })
      await rm(globalGatehouse, { recursive: true, force: true })
      await rm(project, { recursive: true, force: true })
    }
  }

  test("reports missing global registration before install", async () => {
    await withIsolatedEnv(async ({ project }) => {
      const report = await runGatehouseDoctor(project, false)
      expect(report.exitCode).toBe(1)
      expect(report.issues.some((issue) => issue.message.includes("@gatehouse/core"))).toBe(true)
    })
  })

  test("passes config and agents after global install", async () => {
    await withIsolatedEnv(async ({ project }) => {
      await mkdir(path.join(project, ".gatehouse"), { recursive: true })
      await ensureGlobalGatehouseConfig({ locale: "zh" })
      await registerGatehouseInGlobalOpencodeConfig({ locale: "zh" })

      const report = await runGatehouseDoctor(project, false)
      expect(report.issues.filter((issue) => issue.category === "Config" && issue.level === "error")).toHaveLength(0)
      expect(report.issues.filter((issue) => issue.category === "Agents" && issue.level === "error")).toHaveLength(0)
      expect(
        report.issues.some(
          (issue) => issue.category === "Models" && issue.message.includes("未配置 models"),
        ),
      ).toBe(true)
    })
  })

  test("warns when project scaffold is missing", async () => {
    await withIsolatedEnv(async ({ project }) => {
      await registerGatehouseInGlobalOpencodeConfig({ locale: "en" })
      const report = await runGatehouseDoctor(project, false)
      expect(report.issues.some((issue) => issue.message.includes(".gatehouse/"))).toBe(true)
    })
  })

  test("detects scaffolded project config", async () => {
    await withIsolatedEnv(async ({ project }) => {
      await registerGatehouseInGlobalOpencodeConfig({ locale: "zh" })
      await mkdir(path.join(project, ".gatehouse"), { recursive: true })
      await writeFile(
        path.join(project, ".gatehouse/config.yaml"),
        "locale: zh\nmodels:\n  lead: opencode/gpt-5.4\n",
      )
      await writeFile(
        path.join(project, "opencode.jsonc"),
        `${JSON.stringify({ default_agent: "lead", skills: { paths: [".gatehouse"] } }, null, 2)}\n`,
      )

      const report = await runGatehouseDoctor(project, false)
      expect(report.issues.some((issue) => issue.level === "ok" && issue.message.includes(".gatehouse/"))).toBe(true)
      expect(report.issues.some((issue) => issue.category === "Project" && issue.message.includes("default_agent=lead"))).toBe(true)
    })
  })
})
