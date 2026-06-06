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
      const treeDir = path.join(dir, ".gatehouse/architect/trees", missionId)
      await mkdir(treeDir, { recursive: true })
      await Bun.write(
        path.join(treeDir, "manifest.yaml"),
        stringifyYaml({
          mission_id: missionId,
          status: "running",
          root_node: "root",
          created_at: new Date().toISOString(),
          nodes: {
            root: { session_id: "ses_root", parent: null, display_name: "root", profile: "build-coordinator" },
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
          root: { session_id: "ses_root", parent: null, display_name: "root", profile: "build-coordinator" },
        },
      })

      seedActiveMissionRegistry(dir, missionId)

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

  test("mission_complete sets cancelled and records abort attempts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-mission-complete-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      const missionId = "m-done"
      const treeDir = path.join(dir, ".gatehouse/architect/trees", missionId)
      await mkdir(treeDir, { recursive: true })
      await Bun.write(
        path.join(treeDir, "manifest.yaml"),
        stringifyYaml({
          mission_id: missionId,
          status: "running",
          root_node: "root",
          created_at: new Date().toISOString(),
          nodes: {
            root: { session_id: "ses_root", parent: null, display_name: "root", profile: "build-coordinator" },
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
          root: { session_id: "ses_root", parent: null, display_name: "root", profile: "build-coordinator" },
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

      const missions = parseYaml(await Bun.file(path.join(dir, ".gatehouse/lead/missions.yaml")).text())
      if (!isRecord(missions) || !Array.isArray(missions.missions)) throw new Error("bad missions")
      const entry = missions.missions.find((item) => isRecord(item) && item.id === missionId)
      expect(isRecord(entry) && entry.status).toBe("cancelled")

      const manifest = parseYaml(await Bun.file(path.join(treeDir, "manifest.yaml")).text())
      expect(isRecord(manifest) && manifest.status).toBe("archived")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
