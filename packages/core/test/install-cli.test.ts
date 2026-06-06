import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { existsSync, readFileSync } from "node:fs"
import { ensureGlobalGatehouseConfig, gatehouseGlobalConfigPath } from "../src/gatehouse-config.ts"
import { registerGatehouseInGlobalOpencodeConfig } from "../src/setup/project.ts"
import { detectGlobalOpencodeConfigPath } from "../src/setup/global-opencode.ts"
import { parseCliArgs, hasFlag, optionValue } from "../src/cli/parse-args.ts"
import { normalizeGatehouseLocale } from "../src/locale.ts"

describe("install cli helpers", () => {
  test("parseCliArgs handles flags and options", () => {
    const args = parseCliArgs([
      "--no-tui",
      "--locale=zh",
      "--model=opencode/gpt-5.4",
      "--skip-doctor",
      "-C",
      "/tmp/project",
    ])
    expect(hasFlag(args, "--no-tui")).toBe(true)
    expect(optionValue(args, "locale")).toBe("zh")
    expect(optionValue(args, "model")).toBe("opencode/gpt-5.4")
    expect(optionValue(args, "project")).toBe("/tmp/project")
    expect(normalizeGatehouseLocale(optionValue(args, "locale"))).toBe("zh")
  })

  test("ensureGlobalGatehouseConfig writes locale and model", async () => {
    const globalDir = await mkdtemp(path.join(tmpdir(), "gh-install-global-"))
    const prev = process.env.GATEHOUSE_GLOBAL_CONFIG_DIR
    process.env.GATEHOUSE_GLOBAL_CONFIG_DIR = globalDir
    try {
      const first = await ensureGlobalGatehouseConfig({
        locale: "en",
        model: "opencode/gpt-5.4",
      })
      expect(first.created).toBe(true)
      expect(existsSync(gatehouseGlobalConfigPath())).toBe(true)
      const yaml = readFileSync(gatehouseGlobalConfigPath(), "utf8")
      expect(yaml).toContain("locale: en")
      expect(yaml).toContain("lead: opencode/gpt-5.4")

      const second = await ensureGlobalGatehouseConfig({ locale: "zh" })
      expect(second.updated).toBe(true)
      expect(readFileSync(gatehouseGlobalConfigPath(), "utf8")).toContain("locale: zh")
    } finally {
      if (prev === undefined) delete process.env.GATEHOUSE_GLOBAL_CONFIG_DIR
      else process.env.GATEHOUSE_GLOBAL_CONFIG_DIR = prev
      await rm(globalDir, { recursive: true, force: true })
    }
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
      expect(tuiSpecs[0]).toBe("@gatehouse/core/tui")
    } finally {
      if (prev === undefined) delete process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR
      else process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR = prev
      await rm(globalOpencode, { recursive: true, force: true })
    }
  })
})
