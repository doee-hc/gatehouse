import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { existsSync, readFileSync } from "node:fs"
import { ensureGlobalGatehouseConfig, gatehouseGlobalConfigPath } from "../src/gatehouse-config.ts"
import { registerGatehouseInGlobalOpencodeConfig } from "../src/setup/project.ts"
import { detectGlobalOpencodeConfigPath, isGatehouseTuiPluginSpec } from "../src/setup/global-opencode.ts"
import { parseCliArgs, hasFlag, optionValue } from "../src/cli/parse-args.ts"
import { normalizeGatehouseLocale } from "../src/locale.ts"
import { checkInstallPrerequisites } from "../src/cli/prerequisites.ts"
import { runGatehouseDoctor } from "../src/cli/doctor.ts"

describe("install cli helpers", () => {
  test("parseCliArgs handles flags and options", () => {
    const args = parseCliArgs([
      "--no-tui",
      "--locale=zh",
      "--skip-doctor",
      "-C",
      "/tmp/project",
    ])
    expect(hasFlag(args, "--no-tui")).toBe(true)
    expect(optionValue(args, "locale")).toBe("zh")
    expect(optionValue(args, "project")).toBe("/tmp/project")
    expect(normalizeGatehouseLocale(optionValue(args, "locale"))).toBe("zh")
  })

  test("ensureGlobalGatehouseConfig writes locale without model", async () => {
    const globalDir = await mkdtemp(path.join(tmpdir(), "gh-install-global-"))
    const prev = process.env.GATEHOUSE_GLOBAL_CONFIG_DIR
    process.env.GATEHOUSE_GLOBAL_CONFIG_DIR = globalDir
    try {
      const first = await ensureGlobalGatehouseConfig({ locale: "en" })
      expect(first.created).toBe(true)
      expect(existsSync(gatehouseGlobalConfigPath())).toBe(true)
      const yaml = readFileSync(gatehouseGlobalConfigPath(), "utf8")
      expect(yaml).toContain("locale: en")
      expect(yaml).not.toContain("models:")

      const second = await ensureGlobalGatehouseConfig({ locale: "zh" })
      expect(second.updated).toBe(true)
      expect(readFileSync(gatehouseGlobalConfigPath(), "utf8")).toContain("locale: zh")
    } finally {
      if (prev === undefined) delete process.env.GATEHOUSE_GLOBAL_CONFIG_DIR
      else process.env.GATEHOUSE_GLOBAL_CONFIG_DIR = prev
      await rm(globalDir, { recursive: true, force: true })
    }
  })

  test("isGatehouseTuiPluginSpec accepts opencode plug style package root", () => {
    expect(isGatehouseTuiPluginSpec("@gatehouse/core")).toBe(true)
    expect(isGatehouseTuiPluginSpec("@gatehouse/core/tui")).toBe(true)
  })

  test("registerGatehouseInGlobalOpencodeConfig writes server and tui plugins", async () => {
    const globalOpencode = await mkdtemp(path.join(tmpdir(), "gh-install-oc-"))
    const prev = process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR
    process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR = globalOpencode
    try {
      const configPath = await registerGatehouseInGlobalOpencodeConfig({ locale: "zh" })
      expect(configPath).toBe(detectGlobalOpencodeConfigPath())
      const config = JSON.parse(readFileSync(configPath, "utf8")) as { plugin?: unknown[] }
      const specs = (config.plugin ?? []).map((entry) => (Array.isArray(entry) ? entry[0] : entry))
      expect(specs[0]).toBe("@gatehouse/core")

      const tui = JSON.parse(readFileSync(path.join(globalOpencode, "tui.json"), "utf8")) as {
        plugin?: unknown[]
      }
      const tuiSpecs = (tui.plugin ?? []).map((entry) => (Array.isArray(entry) ? entry[0] : entry))
      expect(tuiSpecs[0]).toBe("@gatehouse/core")
    } finally {
      if (prev === undefined) delete process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR
      else process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR = prev
      await rm(globalOpencode, { recursive: true, force: true })
    }
  })

  test("doctor global scope skips project warnings", async () => {
    const globalOpencode = await mkdtemp(path.join(tmpdir(), "gh-install-doc-"))
    const project = await mkdtemp(path.join(tmpdir(), "gh-install-proj-"))
    const prev = process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR
    process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR = globalOpencode
    try {
      await registerGatehouseInGlobalOpencodeConfig({ locale: "zh" })
      const globalReport = await runGatehouseDoctor(project, false, "global")
      expect(globalReport.issues.some((issue) => issue.category === "Project")).toBe(false)
      expect(globalReport.issues.some((issue) => issue.category === "Portal")).toBe(false)

      const fullReport = await runGatehouseDoctor(project, false, "full")
      expect(fullReport.issues.some((issue) => issue.category === "Project")).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR
      else process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR = prev
      await rm(globalOpencode, { recursive: true, force: true })
      await rm(project, { recursive: true, force: true })
    }
  })

  test("checkInstallPrerequisites reports missing opencode", async () => {
    const prev = process.env.OPENCODE_BIN
    process.env.OPENCODE_BIN = "__gatehouse_missing_opencode_test__"
    try {
      const issues = await checkInstallPrerequisites()
      expect(issues.some((issue) => issue.message.includes("OpenCode"))).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_BIN
      else process.env.OPENCODE_BIN = prev
    }
  })
})
