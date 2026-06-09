import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import {
  gatehouseGlobalConfigDir,
  gatehouseProjectConfigPath,
  isAllowedLogoPath,
  loadGatehouseConfig,
  modelForInnerProfile,
  modelForOuterProfile,
  parseGatehouseModel,
  resolveLogoPath,
} from "../src/gatehouse-config.ts"
import {
  INNER_COORDINATOR_AGENT,
  INNER_EXECUTION_AGENT,
  INNER_ROOT_AGENT,
  INNER_ROOT_SOLO_AGENT,
} from "../src/registry/types.ts"

describe("gatehouse config", () => {
  test("merges global and project config", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "gh-config-"))
    const globalDir = await mkdtemp(path.join(tmpdir(), "gh-global-"))
    const prevGlobal = process.env.GATEHOUSE_GLOBAL_CONFIG_DIR
    process.env.GATEHOUSE_GLOBAL_CONFIG_DIR = globalDir

    try {
      await mkdir(path.join(project, ".gatehouse"), { recursive: true })
      await writeFile(
        path.join(globalDir, "config.yaml"),
        `portal:\n  brand:\n    title: Global Title\nagents:\n  lead:\n    name: Global Lead\n`,
      )
      await writeFile(
        gatehouseProjectConfigPath(project),
        `portal:\n  brand:\n    subtitle: Project Sub\nagents:\n  architect:\n    name: Project Arch\n`,
      )

      const config = loadGatehouseConfig(project)

      expect(config.portal.brand.title).toBe("Global Title")
      expect(config.portal.brand.subtitle).toBe("Project Sub")
      expect(config.agents.lead).toBe("Global Lead")
      expect(config.agents.architect).toBe("Project Arch")
      expect(config.agents.curator).toBe("Curator")
      expect(config.locale).toBe("zh")
    } finally {
      if (prevGlobal === undefined) delete process.env.GATEHOUSE_GLOBAL_CONFIG_DIR
      else process.env.GATEHOUSE_GLOBAL_CONFIG_DIR = prevGlobal
      await rm(project, { recursive: true, force: true })
      await rm(globalDir, { recursive: true, force: true })
    }
  })

  test("merges models from global and project config", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "gh-config-models-"))
    const globalDir = await mkdtemp(path.join(tmpdir(), "gh-global-models-"))
    const prevGlobal = process.env.GATEHOUSE_GLOBAL_CONFIG_DIR
    process.env.GATEHOUSE_GLOBAL_CONFIG_DIR = globalDir

    try {
      await mkdir(path.join(project, ".gatehouse"), { recursive: true })
      await writeFile(
        path.join(globalDir, "config.yaml"),
        `models:\n  lead: openai/gpt-5\n  executor: openai/gpt-5-mini\n`,
      )
      await writeFile(
        gatehouseProjectConfigPath(project),
        `models:\n  architect: anthropic/claude-sonnet-4\n  executor: anthropic/claude-haiku-4\n`,
      )

      const config = loadGatehouseConfig(project)

      expect(config.models.lead).toBe("openai/gpt-5")
      expect(config.models.architect).toBe("anthropic/claude-sonnet-4")
      expect(config.models.executor).toBe("anthropic/claude-haiku-4")
      expect(modelForOuterProfile(config.models, "lead")).toBe("openai/gpt-5")
      expect(modelForInnerProfile(config.models, INNER_EXECUTION_AGENT)).toBe("anthropic/claude-haiku-4")
      expect(modelForInnerProfile(config.models, INNER_COORDINATOR_AGENT)).toBeUndefined()
      expect(modelForInnerProfile(config.models, INNER_ROOT_AGENT)).toBeUndefined()
      expect(modelForInnerProfile(config.models, INNER_ROOT_SOLO_AGENT)).toBeUndefined()
    } finally {
      if (prevGlobal === undefined) delete process.env.GATEHOUSE_GLOBAL_CONFIG_DIR
      else process.env.GATEHOUSE_GLOBAL_CONFIG_DIR = prevGlobal
      await rm(project, { recursive: true, force: true })
      await rm(globalDir, { recursive: true, force: true })
    }
  })

  test("merges locale from global and project config", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "gh-config-locale-"))
    const globalDir = await mkdtemp(path.join(tmpdir(), "gh-global-locale-"))
    const prevGlobal = process.env.GATEHOUSE_GLOBAL_CONFIG_DIR
    process.env.GATEHOUSE_GLOBAL_CONFIG_DIR = globalDir

    try {
      await mkdir(path.join(project, ".gatehouse"), { recursive: true })
      await writeFile(path.join(globalDir, "config.yaml"), `locale: zh\n`)
      await writeFile(gatehouseProjectConfigPath(project), `locale: en\n`)

      const config = loadGatehouseConfig(project)
      expect(config.locale).toBe("en")
    } finally {
      if (prevGlobal === undefined) delete process.env.GATEHOUSE_GLOBAL_CONFIG_DIR
      else process.env.GATEHOUSE_GLOBAL_CONFIG_DIR = prevGlobal
      await rm(project, { recursive: true, force: true })
      await rm(globalDir, { recursive: true, force: true })
    }
  })

  test("parseGatehouseModel splits provider and model id", () => {
    expect(parseGatehouseModel("openrouter/anthropic/claude-3-opus")).toEqual({
      providerID: "openrouter",
      id: "anthropic/claude-3-opus",
    })
  })

  test("resolveLogoPath and isAllowedLogoPath", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "gh-logo-"))
    try {
      const relative = resolveLogoPath("brand/logo.png", path.join(project, ".gatehouse"))
      expect(relative).toBe(path.join(project, ".gatehouse/brand/logo.png"))
      expect(isAllowedLogoPath(relative, project)).toBe(true)
      expect(isAllowedLogoPath("/etc/passwd", project)).toBe(false)
      expect(isAllowedLogoPath(path.join(gatehouseGlobalConfigDir(), "logo.png"), project)).toBe(true)
    } finally {
      await rm(project, { recursive: true, force: true })
    }
  })
})
