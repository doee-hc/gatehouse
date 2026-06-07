import { describe, expect, test } from "bun:test"

process.env.GATEHOUSE_LOCAL_PLUGIN = "1"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import {
  ensureOpencodeConfig,
  gatehouseCorePluginSpec,
  prepareGatehouseProject,
  projectOpencodeConfigPath,
} from "../src/setup/project.ts"
import { globalOpencodeAgentPath } from "../src/setup/global-opencode.ts"
import { syncManagedTemplates } from "../src/setup/sync-templates.ts"
import { parseYaml, isRecord } from "../src/yaml.ts"

async function withIsolatedGlobalOpencode<T>(run: (globalDir: string) => Promise<T>) {
  const globalDir = await mkdtemp(path.join(tmpdir(), "gh-global-opencode-"))
  const prev = process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR
  process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR = globalDir
  try {
    return await run(globalDir)
  } finally {
    if (prev === undefined) delete process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR
    else process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR = prev
    await rm(globalDir, { recursive: true, force: true })
  }
}

describe("project setup", () => {
  test("prepareGatehouseProject creates independent layout and root opencode config", async () => {
    await withIsolatedGlobalOpencode(async (globalDir) => {
      const dir = await mkdtemp(path.join(tmpdir(), "gh-project-"))
      const pluginRoot = path.join(import.meta.dir, "..")
      try {
        await prepareGatehouseProject(dir, pluginRoot)

        expect(await Bun.file(path.join(dir, ".gatehouse/zh/skills/lead-meta/SKILL.md")).exists()).toBe(true)
        expect(await Bun.file(path.join(dir, ".gatehouse/en/skills/lead-meta/SKILL.md")).exists()).toBe(true)
        expect(await Bun.file(path.join(dir, ".gatehouse/lead/missions.yaml")).exists()).toBe(true)
        expect(await Bun.file(path.join(dir, ".gatehouse/brand/logo.png")).exists()).toBe(true)
        expect(await Bun.file(path.join(dir, ".opencode/agent/lead.md")).exists()).toBe(false)
        expect(await Bun.file(globalOpencodeAgentPath("lead.md")).exists()).toBe(true)

        const config = JSON.parse(await Bun.file(projectOpencodeConfigPath(dir)).text()) as {
          default_agent?: string
          plugin?: unknown[]
          skills?: { paths?: string[] }
        }
        expect(config.default_agent).toBe("lead")
        expect(config.skills?.paths).toContain(".gatehouse")
        const specs = (config.plugin ?? []).map((entry) => (Array.isArray(entry) ? entry[0] : entry))
        expect(specs[0]).toBe(gatehouseCorePluginSpec(pluginRoot))
        expect(specs).toHaveLength(1)

        expect(await Bun.file(path.join(dir, ".opencode/tui.json")).exists()).toBe(false)
        expect(await Bun.file(path.join(globalDir, "tui.json")).exists()).toBe(false)

        const missionsRaw = parseYaml(await Bun.file(path.join(dir, ".gatehouse/lead/missions.yaml")).text())
        if (!isRecord(missionsRaw)) throw new Error("missions.yaml must be a mapping")
        expect(Array.isArray(missionsRaw.missions) ? missionsRaw.missions.length : -1).toBe(0)

        const configRaw = parseYaml(await Bun.file(path.join(dir, ".gatehouse/config.yaml")).text())
        if (!isRecord(configRaw)) throw new Error("config.yaml must be a mapping")
        const portal = configRaw.portal
        if (!isRecord(portal)) throw new Error("config portal must be a mapping")
        const brand = portal.brand
        if (!isRecord(brand)) throw new Error("config brand must be a mapping")
        expect(brand.logo).toBe("brand/logo.png")

        const adminKey = portal.admin_key
        expect(typeof adminKey).toBe("string")
        expect((adminKey as string).length >= 40).toBe(true)

        const templateLogo = path.join(import.meta.dir, "../templates/zh/gatehouse/brand/logo.png")
        const projectLogo = path.join(dir, ".gatehouse/brand/logo.png")
        expect(Buffer.from(await Bun.file(projectLogo).arrayBuffer()).equals(
          Buffer.from(await Bun.file(templateLogo).arrayBuffer()),
        )).toBe(true)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })
  })

  test("ensureOpencodeConfig without local plugin does not add project plugin entries", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-npm-config-"))
    const pluginRoot = path.join(import.meta.dir, "..")
    const prevDev = process.env.GATEHOUSE_DEV
    const prevLocal = process.env.GATEHOUSE_LOCAL_PLUGIN
    delete process.env.GATEHOUSE_DEV
    delete process.env.GATEHOUSE_LOCAL_PLUGIN
    try {
      await ensureOpencodeConfig(dir, pluginRoot)

      const config = JSON.parse(await Bun.file(projectOpencodeConfigPath(dir)).text()) as {
        plugin?: unknown[]
        default_agent?: string
        skills?: { paths?: string[] }
      }
      expect(config.default_agent).toBe("lead")
      expect(config.skills?.paths).toContain(".gatehouse")
      expect(config.plugin ?? []).toHaveLength(0)

      expect(await Bun.file(path.join(dir, ".opencode/tui.json")).exists()).toBe(false)
    } finally {
      if (prevDev !== undefined) process.env.GATEHOUSE_DEV = prevDev
      else delete process.env.GATEHOUSE_DEV
      if (prevLocal !== undefined) process.env.GATEHOUSE_LOCAL_PLUGIN = prevLocal
      else delete process.env.GATEHOUSE_LOCAL_PLUGIN
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("ensureOpencodeConfig migrates legacy .opencode/opencode.jsonc to project root", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-legacy-config-"))
    const pluginRoot = path.join(import.meta.dir, "..")
    try {
      await Bun.$`mkdir -p ${path.join(dir, ".opencode")}`.quiet()
      await Bun.write(
        path.join(dir, ".opencode/opencode.jsonc"),
        JSON.stringify({ default_agent: "architect", skills: { paths: [".gatehouse", "custom"] } }),
      )

      await ensureOpencodeConfig(dir, pluginRoot)

      const config = JSON.parse(await Bun.file(projectOpencodeConfigPath(dir)).text()) as {
        default_agent?: string
        skills?: { paths?: string[] }
      }
      expect(config.default_agent).toBe("architect")
      expect(config.skills?.paths).toContain(".gatehouse")
      expect(config.skills?.paths).toContain("custom")
      expect(await Bun.file(path.join(dir, ".opencode/opencode.jsonc")).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("sync skips existing brand logo", async () => {
    await withIsolatedGlobalOpencode(async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "gh-sync-brand-"))
      try {
        await syncManagedTemplates(dir)

        const logoPath = path.join(dir, ".gatehouse/brand/logo.png")
        const customLogo = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        await Bun.write(logoPath, customLogo)

        await syncManagedTemplates(dir)

        expect(Buffer.from(await Bun.file(logoPath).arrayBuffer()).equals(customLogo)).toBe(true)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })
  })

  test("sync never overwrites config.yaml", async () => {
    await withIsolatedGlobalOpencode(async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "gh-sync-config-"))
      try {
        await Bun.$`mkdir -p ${path.join(dir, ".gatehouse")}`.quiet()
        const configPath = path.join(dir, ".gatehouse/config.yaml")
        const custom = "portal:\n  brand:\n    title: Custom\n"
        await Bun.write(configPath, custom)

        await syncManagedTemplates(dir)

        expect(await Bun.file(configPath).text()).toBe(custom)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })
  })

  test("sync skips existing outer meta SKILL and prompts", async () => {
    await withIsolatedGlobalOpencode(async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "gh-sync-skill-"))
      try {
        await syncManagedTemplates(dir)
        const skillPath = path.join(dir, ".gatehouse/skills/lead-meta/SKILL.md")
        const skillMarker = "# agent-revised lead-meta\n"
        await Bun.write(skillPath, skillMarker)

        const promptPath = path.join(dir, ".gatehouse/prompts/architect/dispatch-root.md")
        const promptMarker = "# agent-revised dispatch-root\n"
        await Bun.write(promptPath, promptMarker)

        await syncManagedTemplates(dir)

        expect(await Bun.file(skillPath).text()).toBe(skillMarker)
        expect(await Bun.file(promptPath).text()).toBe(promptMarker)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })
  })

  test("sync skips existing missions.yaml and retro-toolkit templates", async () => {
    await withIsolatedGlobalOpencode(async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "gh-sync-live-"))
      try {
        await syncManagedTemplates(dir)

        const missionsPath = path.join(dir, ".gatehouse/lead/missions.yaml")
        const missionsMarker = "schema_version: 2\nmissions:\n  - id: keep-me\n    status: running\n"
        await Bun.write(missionsPath, missionsMarker)

        const retroSkillPath = path.join(dir, ".gatehouse/skills/retro-toolkit/SKILL.md")
        const retroSkillMarker = "# custom retro-toolkit root\n"
        await Bun.write(retroSkillPath, retroSkillMarker)

        const templateSkillPath = path.join(dir, ".gatehouse/skills/retro-toolkit/tools/_template/SKILL.md")
        const templateMarker = "# custom _template skill\n"
        await Bun.write(templateSkillPath, templateMarker)

        await syncManagedTemplates(dir)

        expect(await Bun.file(missionsPath).text()).toBe(missionsMarker)
        expect(await Bun.file(retroSkillPath).text()).toBe(retroSkillMarker)
        expect(await Bun.file(templateSkillPath).text()).toBe(templateMarker)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })
  })

  test("sync skips existing skills tree files", async () => {
    await withIsolatedGlobalOpencode(async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "gh-sync-skills-"))
      try {
        await syncManagedTemplates(dir)

        const domainsPath = path.join(dir, ".gatehouse/skills/domains.yaml")
        const domainsMarker = "schema_version: 1\ndomains:\n  - id: custom-domain\n"
        await Bun.write(domainsPath, domainsMarker)

        const domainSkillDir = path.join(dir, ".gatehouse/skills/by-domain/custom-domain/my-skill")
        await Bun.$`mkdir -p ${domainSkillDir}`.quiet()
        const domainSkillPath = path.join(domainSkillDir, "SKILL.md")
        const domainSkillMarker = "# custom domain skill\n"
        await Bun.write(domainSkillPath, domainSkillMarker)

        await syncManagedTemplates(dir)

        expect(await Bun.file(domainsPath).text()).toBe(domainsMarker)
        expect(await Bun.file(domainSkillPath).text()).toBe(domainSkillMarker)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })
  })

  test("ensureOpencodeConfig preserves channels-core plugin in local dev mode", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-channels-config-"))
    const pluginRoot = path.join(import.meta.dir, "..")
    const channelsSpec = pathToFileURL(path.resolve(import.meta.dir, "../../channels-core")).href
    try {
      await Bun.write(
        projectOpencodeConfigPath(dir),
        JSON.stringify({
          plugin: [
            [gatehouseCorePluginSpec(pluginRoot), {}],
            [channelsSpec, {}],
          ],
        }),
      )

      await ensureOpencodeConfig(dir, pluginRoot)

      const config = JSON.parse(await Bun.file(projectOpencodeConfigPath(dir)).text()) as {
        plugin?: unknown[]
      }
      const specs = (config.plugin ?? []).map((entry) => (Array.isArray(entry) ? entry[0] : entry))
      expect(specs).toContain(channelsSpec)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("ensureOpencodeConfig strips gatehouse tui plugin from server config", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-tui-server-"))
    const pluginRoot = path.join(import.meta.dir, "..")
    const prevLocal = process.env.GATEHOUSE_LOCAL_PLUGIN
    delete process.env.GATEHOUSE_LOCAL_PLUGIN
    try {
      await Bun.write(
        projectOpencodeConfigPath(dir),
        JSON.stringify({
          plugin: [
            [gatehouseCorePluginSpec(pluginRoot), {}],
            ["@gatehouse/core/tui", {}],
          ],
        }),
      )

      await ensureOpencodeConfig(dir, pluginRoot)

      const config = JSON.parse(await Bun.file(projectOpencodeConfigPath(dir)).text()) as {
        plugin?: unknown[]
      }
      const specs = (config.plugin ?? []).map((entry) => (Array.isArray(entry) ? entry[0] : entry))
      expect(specs).not.toContain("@gatehouse/core/tui")
      expect(specs.some((spec) => typeof spec === "string" && spec.includes("/tui/"))).toBe(false)
    } finally {
      if (prevLocal !== undefined) process.env.GATEHOUSE_LOCAL_PLUGIN = prevLocal
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("ensureOpencodeConfig replaces legacy gatehouse-plugin entry", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-config-"))
    const pluginRoot = path.join(import.meta.dir, "..")
    try {
      await Bun.write(
        projectOpencodeConfigPath(dir),
        JSON.stringify({
          plugin: [["../packages/gatehouse-plugin", { profile: "coordinator" }]],
        }),
      )
      await Bun.$`mkdir -p ${path.join(dir, ".gatehouse")}`.quiet()

      await ensureOpencodeConfig(dir, pluginRoot)

      const config = JSON.parse(await Bun.file(projectOpencodeConfigPath(dir)).text()) as {
        plugin?: unknown[]
      }
      const specs = (config.plugin ?? []).map((entry) => (Array.isArray(entry) ? entry[0] : entry))
      expect(specs[0]).toBe(gatehouseCorePluginSpec(pluginRoot))
      expect(specs.some((spec) => typeof spec === "string" && spec.includes("../packages/gatehouse-plugin"))).toBe(
        false,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("gatehouseArchivePluginSpec uses file: protocol for tgz", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-archive-"))
    const archive = path.join(dir, "gatehouse-core-0.1.0.tgz")
    try {
      await Bun.write(archive, "not-a-real-tgz")
      const { gatehouseArchivePluginSpec } = await import("../src/setup/package.ts")
      expect(gatehouseArchivePluginSpec(archive)).toBe(`file:${archive}`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
