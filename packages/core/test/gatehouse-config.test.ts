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
  resolveWatchdogConfig,
} from "../src/gatehouse-config.ts"
import {
  AUTOPILOT_WAKE_POLL_MS,
  AUTOPILOT_WAKE_THRESHOLD_MS,
} from "../src/watchdog/autopilot.ts"
import {
  ORCHESTRATION_STALL_NOTIFY_COOLDOWN_MS,
  ORCHESTRATION_STALL_RESUME_COOLDOWN_MS,
} from "../src/watchdog/orchestration-stall.ts"
import { ORCHESTRATION_STALL_THRESHOLD_MS } from "../src/orchestration/stall.ts"
import {
  WATCHDOG_IDLE_THRESHOLD_MS,
  WATCHDOG_POLL_MS,
  WATCHDOG_WAKE_COOLDOWN_MS,
} from "../src/watchdog/tick.ts"
import { INNER_EXECUTION_AGENT } from "../src/registry/types.ts"
import { modelForInnerNode } from "../src/tree/parse.ts"
import type { OrchestrationPlan } from "../src/orchestration/plan-types.ts"

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
      expect(config.locale).toBe("en")
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
      expect(modelForInnerProfile(config.models, "build-extract")).toBeUndefined()
      const plan: OrchestrationPlan = {
        schema_version: 1,
        mission_id: "m1",
        plan_version: "v1",
        script_hash: "hash",
        warnings: [],
        steps: [
          { id: "step-0", op: "run", statement: 'await ctx.run("leaf", { text: "go" })', nodeId: "leaf" },
          {
            id: "step-1",
            op: "run",
            statement: 'await ctx.run("root", { text: "summary", dependsOn: [{ node: "leaf", summary: true }] })',
            nodeId: "root",
          },
        ],
      }
      expect(
        modelForInnerNode(config.models, plan, "root"),
      ).toBe(config.models.coordinator)
      expect(
        modelForInnerNode(config.models, plan, "leaf"),
      ).toBe("anthropic/claude-haiku-4")
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

  test("resolveWatchdogConfig merges global and project overrides", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "gh-config-watchdog-"))
    const globalDir = await mkdtemp(path.join(tmpdir(), "gh-global-watchdog-"))
    const prevGlobal = process.env.GATEHOUSE_GLOBAL_CONFIG_DIR
    process.env.GATEHOUSE_GLOBAL_CONFIG_DIR = globalDir

    try {
      await mkdir(path.join(project, ".gatehouse"), { recursive: true })
      await writeFile(
        path.join(globalDir, "config.yaml"),
        `watchdog:
  poll_ms: 3000
  idle_threshold_ms: 15000
  wake_cooldown_ms: 45000
  autopilot:
    poll_ms: 60000
`,
      )
      await writeFile(
        gatehouseProjectConfigPath(project),
        `watchdog:
  execution:
    poll_ms: 2500
  record:
    idle_threshold_ms: 12000
  orchestration_stall:
    stall_threshold_ms: 240000
  autopilot:
    idle_threshold_ms: 900000
`,
      )

      const config = loadGatehouseConfig(project)

      expect(config.watchdog.execution).toEqual({
        poll_ms: 2500,
        idle_threshold_ms: 15000,
        wake_cooldown_ms: 45000,
      })
      expect(config.watchdog.record).toEqual({
        poll_ms: 3000,
        idle_threshold_ms: 12000,
        wake_cooldown_ms: 45000,
      })
      expect(config.watchdog.orchestration_stall).toEqual({
        stall_threshold_ms: 240000,
        notify_cooldown_ms: ORCHESTRATION_STALL_NOTIFY_COOLDOWN_MS,
        resume_cooldown_ms: ORCHESTRATION_STALL_RESUME_COOLDOWN_MS,
      })
      expect(config.watchdog.autopilot).toEqual({
        poll_ms: 60000,
        idle_threshold_ms: 900000,
        wake_cooldown_ms: 45000,
      })
    } finally {
      if (prevGlobal === undefined) delete process.env.GATEHOUSE_GLOBAL_CONFIG_DIR
      else process.env.GATEHOUSE_GLOBAL_CONFIG_DIR = prevGlobal
      await rm(project, { recursive: true, force: true })
      await rm(globalDir, { recursive: true, force: true })
    }
  })

  test("resolveWatchdogConfig uses built-in defaults", () => {
    expect(resolveWatchdogConfig()).toEqual({
      execution: {
        poll_ms: WATCHDOG_POLL_MS,
        idle_threshold_ms: WATCHDOG_IDLE_THRESHOLD_MS,
        wake_cooldown_ms: WATCHDOG_WAKE_COOLDOWN_MS,
      },
      record: {
        poll_ms: WATCHDOG_POLL_MS,
        idle_threshold_ms: WATCHDOG_IDLE_THRESHOLD_MS,
        wake_cooldown_ms: WATCHDOG_WAKE_COOLDOWN_MS,
      },
      orchestration_stall: {
        stall_threshold_ms: ORCHESTRATION_STALL_THRESHOLD_MS,
        notify_cooldown_ms: ORCHESTRATION_STALL_NOTIFY_COOLDOWN_MS,
        resume_cooldown_ms: ORCHESTRATION_STALL_RESUME_COOLDOWN_MS,
      },
      autopilot: {
        poll_ms: AUTOPILOT_WAKE_POLL_MS,
        idle_threshold_ms: AUTOPILOT_WAKE_THRESHOLD_MS,
        wake_cooldown_ms: WATCHDOG_WAKE_COOLDOWN_MS,
      },
    })
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
