import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"
import {
  channelsPluginSpec,
  CHANNELS_PLUGIN_PACKAGE,
  ensureChannelsPluginInOpencodeConfig,
  projectOpencodeConfigPath,
} from "../../src/channels/opencode-config.ts"

const corePackageRoot = path.join(import.meta.dir, "../..")

describe("opencode-config", () => {
  test("channelsPluginSpec uses package root in local dev mode", () => {
    const root = corePackageRoot
    const prevDev = process.env.GATEHOUSE_DEV
    const prevLocal = process.env.CHANNELS_LOCAL_PLUGIN
    process.env.GATEHOUSE_DEV = "1"
    delete process.env.CHANNELS_LOCAL_PLUGIN
    try {
      expect(channelsPluginSpec(root)).toBe(
        pathToFileURL(path.join(root, "src/channels/plugin/index.ts")).href,
      )
    } finally {
      if (prevDev === undefined) delete process.env.GATEHOUSE_DEV
      else process.env.GATEHOUSE_DEV = prevDev
      if (prevLocal === undefined) delete process.env.CHANNELS_LOCAL_PLUGIN
      else process.env.CHANNELS_LOCAL_PLUGIN = prevLocal
    }
  })

  test("channelsPluginSpec uses npm package name in production mode", () => {
    const root = corePackageRoot
    const prevDev = process.env.GATEHOUSE_DEV
    const prevLocal = process.env.CHANNELS_LOCAL_PLUGIN
    delete process.env.GATEHOUSE_DEV
    delete process.env.CHANNELS_LOCAL_PLUGIN
    try {
      expect(channelsPluginSpec(root)).toBe(CHANNELS_PLUGIN_PACKAGE)
    } finally {
      if (prevDev === undefined) delete process.env.GATEHOUSE_DEV
      else process.env.GATEHOUSE_DEV = prevDev
      if (prevLocal === undefined) delete process.env.CHANNELS_LOCAL_PLUGIN
      else process.env.CHANNELS_LOCAL_PLUGIN = prevLocal
    }
  })

  test("ensureChannelsPluginInOpencodeConfig writes project root opencode.jsonc only", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-ch-opencode-"))
    const packageRoot = corePackageRoot
    const prevDev = process.env.GATEHOUSE_DEV
    process.env.GATEHOUSE_DEV = "1"
    try {
      const result = await ensureChannelsPluginInOpencodeConfig(dir, packageRoot)

      expect(result.configPath).toBe(projectOpencodeConfigPath(dir))
      expect(result.added).toBe(true)
      expect(await Bun.file(path.join(dir, "opencode.json")).exists()).toBe(false)
      expect(await Bun.file(path.join(dir, ".opencode", "opencode.jsonc")).exists()).toBe(false)
      expect(await Bun.file(path.join(dir, ".opencode")).exists()).toBe(false)

      const config = JSON.parse(await Bun.file(result.configPath).text()) as {
        plugin?: unknown[]
      }
      const specs = (config.plugin ?? []).map((entry) => (Array.isArray(entry) ? entry[0] : entry))
      expect(specs[0]).toBe(pathToFileURL(path.join(packageRoot, "src/channels/plugin/index.ts")).href)
    } finally {
      if (prevDev === undefined) delete process.env.GATEHOUSE_DEV
      else process.env.GATEHOUSE_DEV = prevDev
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("ensureChannelsPluginInOpencodeConfig migrates legacy opencode.json to root opencode.jsonc", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-ch-legacy-json-"))
    const packageRoot = corePackageRoot
    const prevDev = process.env.GATEHOUSE_DEV
    process.env.GATEHOUSE_DEV = "1"
    try {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({ plugin: [["@gatehouse/core/channels/plugin", {}]] }),
      )

      const result = await ensureChannelsPluginInOpencodeConfig(dir, packageRoot)

      expect(result.configPath).toBe(projectOpencodeConfigPath(dir))
      expect(await Bun.file(path.join(dir, "opencode.json")).exists()).toBe(false)
      expect(await Bun.file(projectOpencodeConfigPath(dir)).exists()).toBe(true)

      const config = JSON.parse(await Bun.file(result.configPath).text()) as {
        plugin?: unknown[]
      }
      const specs = (config.plugin ?? []).map((entry) => (Array.isArray(entry) ? entry[0] : entry))
      expect(specs).toContain(pathToFileURL(path.join(packageRoot, "src/channels/plugin/index.ts")).href)
      expect(specs.filter((entry) => String(entry).includes("/channels/plugin"))).toHaveLength(1)
    } finally {
      if (prevDev === undefined) delete process.env.GATEHOUSE_DEV
      else process.env.GATEHOUSE_DEV = prevDev
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("ensureChannelsPluginInOpencodeConfig migrates .opencode/opencode.jsonc to project root", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-ch-legacy-dir-"))
    const packageRoot = corePackageRoot
    const prevDev = process.env.GATEHOUSE_DEV
    process.env.GATEHOUSE_DEV = "1"
    try {
      const legacyDir = path.join(dir, ".opencode")
      await Bun.$`mkdir -p ${legacyDir}`.quiet()
      await Bun.write(
        path.join(legacyDir, "opencode.jsonc"),
        JSON.stringify({ default_agent: "lead", plugin: [["file:///tmp/channels/plugin/index.ts", {}]] }),
      )

      await ensureChannelsPluginInOpencodeConfig(dir, packageRoot)

      expect(await Bun.file(projectOpencodeConfigPath(dir)).exists()).toBe(true)
      expect(await Bun.file(path.join(legacyDir, "opencode.jsonc")).exists()).toBe(false)
    } finally {
      if (prevDev === undefined) delete process.env.GATEHOUSE_DEV
      else process.env.GATEHOUSE_DEV = prevDev
      await rm(dir, { recursive: true, force: true })
    }
  })
})
