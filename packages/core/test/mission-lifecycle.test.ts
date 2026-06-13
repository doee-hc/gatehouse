import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { missionRetroTool } from "../src/tools/retro.ts"
import { missionCompleteTool } from "../src/tools/mission-complete.ts"
import { getRegistryStore } from "../src/registry/context.ts"
import { OUTER_LEAD_ID, OUTER_ARCHITECT_ID, OUTER_CURATOR_ID } from "../src/registry/types.ts"
import { stringifyYaml, isRecord, parseYaml } from "../src/yaml.ts"
import { seedActiveMissionRegistry } from "./copy-example-mission.ts"
import { seedSubmittedDelivery } from "./seed-delivery.ts"

const scaffoldScript = path.join(import.meta.dir, "../script/scaffold.ts")

function mockToolContext(directory: string, sessionID: string, agent: string): ToolContext {
  return {
    sessionID,
    messageID: "test-message",
    agent,
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata() {},
    ask() {
      throw new Error("ask not implemented in mock")
    },
  }
}

function toolOutput(result: Awaited<ReturnType<ReturnType<typeof missionRetroTool>["execute"]>>) {
  return typeof result === "string" ? result : result.output
}

async function registerOuterTeam(pluginInput: PluginInput) {
  const registry = await getRegistryStore(pluginInput)
  registry.register({
    agentId: OUTER_LEAD_ID,
    scope: "outer",
    profile: "lead",
    sessionId: "ses_lead",
    displayName: "Lead",
  })
  registry.register({
    agentId: OUTER_ARCHITECT_ID,
    scope: "outer",
    profile: "architect",
    sessionId: "ses_architect",
    displayName: "Architect",
  })
  registry.register({
    agentId: OUTER_CURATOR_ID,
    scope: "outer",
    profile: "curator",
    sessionId: "ses_curator",
    displayName: "Curator",
  })
}

describe("mission lifecycle tools", () => {
  test("mission_retro rejects when inner session is busy", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-mission-retro-busy-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      const missionId = "m-busy"
      const treeDir = path.join(dir, ".gatehouse/trees", missionId)
      await mkdir(treeDir, { recursive: true })
      await Bun.write(
        path.join(treeDir, "manifest.yaml"),
        stringifyYaml({
          mission_id: missionId,
          status: "running",
          root_node: "root",
          created_at: new Date().toISOString(),
          nodes: {
            root: { session_id: "ses_root", parent: null, display_name: "root", profile: "build-root" },
          },
        }),
      )
      await Bun.write(
        path.join(dir, ".gatehouse/lead/missions.yaml"),
        stringifyYaml({
          schema_version: 2,
          missions: [{ id: missionId, status: "running", done_when: [], must_not: [] }],
        }),
      )

      const registry = await getRegistryStore({ directory: dir } as PluginInput)
      registry.syncInnerFromManifest({
        mission_id: missionId,
        status: "running",
        root_node: "root",
        created_at: new Date().toISOString(),
        nodes: {
          root: { session_id: "ses_root", parent: null, display_name: "root", profile: "build-root" },
        },
      })

      seedActiveMissionRegistry(dir, missionId)
      await seedSubmittedDelivery(dir, missionId)

      const mockClient = {
        session: {
          async status() {
            return { data: { ses_root: { type: "busy" } } }
          },
        },
      }

      const pluginInput = {
        directory: dir,
        client: mockClient,
        serverUrl: new URL("http://127.0.0.1:4096"),
      } as unknown as PluginInput
      await registerOuterTeam(pluginInput)

      const output = toolOutput(
        await missionRetroTool(pluginInput).execute(
          {},
          mockToolContext(dir, "ses_lead", "lead"),
        ),
      )
      const parsed = JSON.parse(output) as { ok: boolean; error?: { code: string } }
      expect(parsed.ok).toBe(false)
      expect(parsed.error?.code).toBe("MISSION_RETRO_FAILED")
      expect(output).toContain("idle")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("mission_complete rejects retro done when architect rollup pending", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-mission-complete-retro-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      const missionId = "m-retro-pending"
      const reportRel = `.gatehouse/trees/${missionId}/reports/nodes/root-retro.md`
      await mkdir(path.dirname(path.join(dir, reportRel)), { recursive: true })
      await Bun.write(path.join(dir, reportRel), "# retro\n")
      await Bun.write(
        path.join(dir, ".gatehouse/lead/missions.yaml"),
        stringifyYaml({
          schema_version: 3,
          missions: [{ id: missionId, status: "retro", done_when: [], must_not: [] }],
        }),
      )

      const pluginInput = {
        directory: dir,
        serverUrl: new URL("http://127.0.0.1:5099"),
        client: {
          session: {
            async status() {
              return { data: {} }
            },
            async promptAsync() {},
            async messages() {
              return { data: [] }
            },
            async get() {
              return { data: { time: { created: 0, updated: 1000 } } }
            },
            async delete() {},
          },
        },
      } as unknown as PluginInput

      await registerOuterTeam(pluginInput)
      const registry = await getRegistryStore(pluginInput)
      registry.registerRetroNode({
        missionId,
        nodeId: "root",
        profile: "build-root",
        sessionId: "ses_retro_root",
      })
      registry.beginRetroRun(missionId, ["root"])
      await registry.recordRetroCompletion({
        missionId,
        nodeId: "root",
        sessionId: "ses_retro_root",
        reportPath: reportRel,
      })
      expect(registry.retroStatus(missionId).architectNotified).toBe(true)
      expect(registry.retroStatus(missionId).architectLeadNotified).toBe(false)

      const output = toolOutput(
        await missionCompleteTool(pluginInput).execute(
          { mission_id: missionId, status: "done" },
          mockToolContext(dir, "ses_lead", "lead"),
        ),
      )
      const parsed = JSON.parse(output) as {
        ok: boolean
        error?: { code: string; details?: { pending?: string[] } }
      }
      expect(parsed.ok).toBe(false)
      expect(parsed.error?.code).toBe("RETRO_ROLLUP_PENDING")
      expect(parsed.error?.details?.pending).toContain("architect_summary_to_lead")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("mission_complete sets cancelled and records abort attempts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-mission-complete-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      const missionId = "m-done"
      const treeDir = path.join(dir, ".gatehouse/trees", missionId)
      await mkdir(treeDir, { recursive: true })
      await Bun.write(
        path.join(treeDir, "manifest.yaml"),
        stringifyYaml({
          mission_id: missionId,
          status: "running",
          root_node: "root",
          created_at: new Date().toISOString(),
          nodes: {
            root: { session_id: "ses_root", parent: null, display_name: "root", profile: "build-root" },
          },
        }),
      )
      await Bun.write(
        path.join(dir, ".gatehouse/lead/missions.yaml"),
        stringifyYaml({
          schema_version: 2,
          missions: [{ id: missionId, status: "running", done_when: [], must_not: [] }],
        }),
      )

      const promptCalls: string[] = []
      const deleteCalls: string[] = []
      const pluginInput = {
        directory: dir,
        serverUrl: new URL("http://127.0.0.1:5099"),
        client: {
          session: {
            async status() {
              return { data: {} }
            },
            async promptAsync(input: { path?: { id: string } }) {
              promptCalls.push(input.path?.id ?? "")
            },
            async messages() {
              return { data: [] }
            },
            async get() {
              return { data: { time: { created: 0, updated: 1000 } } }
            },
            async delete(input: { path?: { id: string } }) {
              deleteCalls.push(input.path?.id ?? "")
            },
          },
        },
      } as unknown as PluginInput

      const registry = await getRegistryStore(pluginInput)
      registry.syncInnerFromManifest({
        mission_id: missionId,
        status: "running",
        root_node: "root",
        created_at: new Date().toISOString(),
        nodes: {
          root: { session_id: "ses_root", parent: null, display_name: "root", profile: "build-root" },
        },
      })
      await registerOuterTeam(pluginInput)

      const complete = missionCompleteTool(pluginInput)
      const output = toolOutput(
        await complete.execute(
          { mission_id: missionId, status: "cancelled" },
          mockToolContext(dir, "ses_lead", "lead"),
        ),
      )
      const parsed = JSON.parse(output) as { ok: boolean; data?: Record<string, unknown> }
      expect(parsed.ok).toBe(true)
      expect(promptCalls).toContain("ses_architect")
      expect(promptCalls).toContain("ses_curator")
      expect(deleteCalls).toContain("ses_root")

      const contextIndex = path.join(dir, ".gatehouse/trees", missionId, "context/index.json")
      expect(await Bun.file(contextIndex).exists()).toBe(true)

      const missions = parseYaml(await Bun.file(path.join(dir, ".gatehouse/lead/missions.yaml")).text())
      if (!isRecord(missions) || !Array.isArray(missions.missions)) throw new Error("bad missions")
      const entry = missions.missions.find((item) => isRecord(item) && item.id === missionId)
      expect(isRecord(entry) && entry.status).toBe("cancelled")

      const manifest = parseYaml(
        await Bun.file(
          path.join(dir, ".gatehouse/internal/exports/trees", missionId, "manifest.yaml"),
        ).text(),
      )
      expect(isRecord(manifest) && manifest.status).toBe("archived")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
