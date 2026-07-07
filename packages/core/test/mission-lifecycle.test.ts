import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { missionRetroTool } from "../src/tools/retro.ts"
import { missionCompleteTool } from "../src/tools/mission-complete.ts"
import { waitForAllMissionAgentsIdle, missionEndedOuterMessage } from "../src/missions/lifecycle.ts"
import { getRegistryStore } from "../src/registry/context.ts"
import { OUTER_LEAD_ID, OUTER_ARCHITECT_ID, OUTER_CURATOR_ID } from "../src/registry/types.ts"
import { stringifyYaml, isRecord, parseYaml } from "../src/yaml.ts"
import { RegistryDatabase } from "../src/registry/db.ts"
import { writeMissionManifest } from "../src/missions/manifest/store.ts"
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
  test("mission_retro rejects when inner session stays busy", async () => {
    const prevWait = process.env.GATEHOUSE_MISSION_IDLE_WAIT_MS
    process.env.GATEHOUSE_MISSION_IDLE_WAIT_MS = "150"
    const dir = await mkdtemp(path.join(tmpdir(), "gh-mission-retro-busy-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      const missionId = "m-busy"
      const manifest = {
        mission_id: missionId,
        status: "running" as const,
        terminal_node: "terminal",
        created_at: new Date().toISOString(),
        nodes: {
          terminal: { session_id: "ses_root", display_name: "root", profile: "build" },
        },
      }
      await writeMissionManifest(dir, manifest)
      await Bun.write(
        path.join(dir, ".gatehouse/lead/missions.yaml"),
        stringifyYaml({
          schema_version: 2,
          missions: [{ id: missionId, status: "running", done_when: [], must_not: [] }],
        }),
      )

      const registry = await getRegistryStore({ directory: dir } as PluginInput)
      registry.syncInnerFromManifest(manifest)

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
      if (prevWait === undefined) delete process.env.GATEHOUSE_MISSION_IDLE_WAIT_MS
      else process.env.GATEHOUSE_MISSION_IDLE_WAIT_MS = prevWait
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("waitForAllMissionAgentsIdle succeeds after transient session busy", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-mission-idle-wait-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      const missionId = "m-transient-busy"
      const registry = await getRegistryStore({ directory: dir } as PluginInput)
      const manifest = {
        mission_id: missionId,
        status: "running" as const,
        terminal_node: "terminal",
        created_at: new Date().toISOString(),
        nodes: {
          terminal: { session_id: "ses_root", display_name: "root", profile: "build" },
        },
      }
      await writeMissionManifest(dir, manifest)
      registry.syncInnerFromManifest(manifest)

      let polls = 0
      const mockClient = {
        session: {
          async status() {
            polls += 1
            return { data: polls < 3 ? { ses_root: { type: "busy" } } : {} }
          },
        },
      }
      const pluginInput = {
        directory: dir,
        client: mockClient,
      } as unknown as PluginInput

      const result = await waitForAllMissionAgentsIdle({
        registry,
        client: mockClient as PluginInput["client"],
        directory: dir,
        plugin: pluginInput,
        missionId,
        scopes: ["inner"],
        timeoutMs: 500,
        pollIntervalMs: 20,
      })

      expect(result.ok).toBe(true)
      expect(result.waited_ms > 0).toBe(true)
      expect(polls >= 3).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("mission_complete rejects retro done when architect summary pending", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-mission-complete-retro-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      const missionId = "m-retro-pending"
      const reportRel = `.gatehouse/missions/${missionId}/reports/retro-summary.md`
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
      registry.retro.registerRetroAnalyst({
        missionId,
        sessionId: "ses_retro_root",
      })
      registry.retro.beginRetroRun(missionId)
      await registry.retro.recordRetroSummary({
        missionId,
        sessionId: "ses_retro_root",
        reportPath: reportRel,
      })
      expect(registry.retro.retroStatus(missionId).architectNotified).toBe(true)
      expect(registry.retro.retroStatus(missionId).architectLeadNotified).toBe(false)

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
      expect(parsed.error?.code).toBe("RETRO_SUMMARY_PENDING")
      expect(parsed.error?.details?.pending).toContain("architect_retro_summary")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("missionEndedOuterMessage states no retro and no action when retro skipped", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-mission-ended-msg-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      const message = missionEndedOuterMessage("m-no-retro", "done", dir, { retroSkipped: true })
      expect(message).toContain("无复盘")
      expect(message).toContain("本轮未进行复盘")
      expect(message).not.toContain("gatehouse_mission_retro")
      expect(message).toContain("这只是一个通知，你不需要有任何动作")
      const afterRetro = missionEndedOuterMessage("m-after-retro", "done", dir, { retroSkipped: false })
      expect(afterRetro).not.toContain("无复盘")
      expect(afterRetro).toContain("请勿再分配任务")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("mission_complete sets cancelled and records abort attempts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-mission-complete-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      const missionId = "m-done"
      const manifest = {
        mission_id: missionId,
        status: "running" as const,
        terminal_node: "terminal",
        created_at: new Date().toISOString(),
        nodes: {
          terminal: { session_id: "ses_root", display_name: "root", profile: "build" },
        },
      }
      await writeMissionManifest(dir, manifest)
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
      registry.syncInnerFromManifest(manifest)
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

      const contextIndex = path.join(dir, ".gatehouse/missions", missionId, "context/index.json")
      expect(await Bun.file(contextIndex).exists()).toBe(true)

      const missions = parseYaml(await Bun.file(path.join(dir, ".gatehouse/lead/missions.yaml")).text())
      if (!isRecord(missions) || !Array.isArray(missions.missions)) throw new Error("bad missions")
      const entry = missions.missions.find((item) => isRecord(item) && item.id === missionId)
      expect(isRecord(entry) && entry.status).toBe("cancelled")

      const manifestFromDb = new RegistryDatabase(dir, { readonly: true }).getMissionManifest(missionId)
      expect(manifestFromDb?.status).toBe("archived")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
