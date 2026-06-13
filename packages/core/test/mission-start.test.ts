import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { missionStartTool } from "../src/tools/mission-start.ts"
import { missionInfoTool } from "../src/tools/mission-info.ts"
import { parseDoneWhenCriteriaFromRaw } from "../src/delivery/criteria.ts"
import { readMissionContractRawRegistry } from "../src/execution/artifacts.ts"
import { startMissionFromYaml } from "../src/missions/start.ts"
import { parseMissionsFile } from "../src/missions/parse.ts"
import { leadDir } from "../src/paths.ts"
import { getRegistryStore } from "../src/registry/context.ts"
import { OUTER_LEAD_ID, OUTER_ARCHITECT_ID } from "../src/registry/types.ts"
import { stringifyYaml } from "../src/yaml.ts"
import { mkdir } from "node:fs/promises"
import { copyExampleMissionQueued } from "./copy-example-mission.ts"

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

function toolOutput(result: Awaited<ReturnType<ReturnType<typeof missionStartTool>["execute"]>>) {
  return typeof result === "string" ? result : result.output
}

describe("gatehouse_mission_start", () => {
  test("starts queued mission, registers snapshot, mission_info returns contract for architect", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-mission-start-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      await copyExampleMissionQueued(dir)

      const pluginInput = {
        directory: dir,
        client: {
          session: {
            async promptAsync() {},
            async status() {
              return { data: {} }
            },
          },
        },
      } as unknown as PluginInput

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

      const startOut = JSON.parse(
        toolOutput(
          await missionStartTool(pluginInput).execute(
            { mission_id: "core-example-smoke-v1" },
            mockToolContext(dir, "ses_lead", "lead"),
          ),
        ),
      ) as { ok: boolean; data?: { status: string } }
      expect(startOut.ok).toBe(true)
      expect(startOut.data?.status).toBe("running")

      const missions = parseMissionsFile(await Bun.file(path.join(dir, ".gatehouse/lead/missions.yaml")).text())
      const entry = missions.missions.find((item) => item.id === "core-example-smoke-v1")
      expect(entry?.status).toBe("running")

      const infoOut = JSON.parse(
        toolOutput(await missionInfoTool(pluginInput).execute({}, mockToolContext(dir, "ses_architect", "architect"))),
      ) as {
        ok: boolean
        data?: {
          mission_id: string
          role_view: string
          contract?: { objective?: string; done_when: string[]; must_not: string[] }
        }
      }
      expect(infoOut.ok).toBe(true)
      expect(infoOut.data?.mission_id).toBe("core-example-smoke-v1")
      expect(infoOut.data?.role_view).toBe("architect")
      expect((infoOut.data?.contract?.done_when.length ?? 0) > 0).toBe(true)
      expect((infoOut.data?.contract?.must_not.length ?? 0) > 0).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("startMissionFromYaml freezes structured done_when publish before yaml round-trip", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-mission-start-publish-"))
    const deliverable = "docs/research/loop-vs-agent.md"
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      await mkdir(leadDir(dir), { recursive: true })
      await Bun.write(
        path.join(leadDir(dir), "missions.yaml"),
        stringifyYaml({
          schema_version: 3,
          missions: [
            {
              id: "m-publish-freeze",
              status: "queued",
              objective: "Research report",
              done_when: [
                {
                  text: "Structured report with publish",
                  path: deliverable,
                  publish: deliverable,
                },
                "At least one comparison table",
              ],
              must_not: [],
            },
          ],
        }),
      )

      const pluginInput = { directory: dir, client: {} } as unknown as PluginInput
      const registry = await getRegistryStore(pluginInput)
      registry.register({
        agentId: OUTER_LEAD_ID,
        scope: "outer",
        profile: "lead",
        sessionId: "ses_lead",
        displayName: "Lead",
      })

      await startMissionFromYaml({
        projectDirectory: dir,
        missionId: "m-publish-freeze",
        registry,
      })

      const raw = await readMissionContractRawRegistry(dir, "m-publish-freeze")
      expect(raw != null).toBe(true)
      const criteria = parseDoneWhenCriteriaFromRaw({ done_when: (raw as { done_when: unknown[] }).done_when })
      expect(criteria[0]?.check).toEqual({ kind: "path_exists", path: deliverable })
      expect(criteria[0]?.text).toContain("Structured report")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("rejects mission_start from a second unregistered lead session", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-mission-start-dup-lead-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      await copyExampleMissionQueued(dir)

      const pluginInput = {
        directory: dir,
        client: {
          session: {
            async promptAsync() {},
            async status() {
              return { data: {} }
            },
          },
        },
      } as unknown as PluginInput

      const registry = await getRegistryStore(pluginInput)
      registry.register({
        agentId: OUTER_LEAD_ID,
        scope: "outer",
        profile: "lead",
        sessionId: "ses_lead",
        displayName: "Lead",
      })

      const startOut = JSON.parse(
        toolOutput(
          await missionStartTool(pluginInput).execute(
            { mission_id: "core-example-smoke-v1" },
            mockToolContext(dir, "ses_other_lead", "lead"),
          ),
        ),
      ) as { ok: boolean; error?: { code: string } }
      expect(startOut.ok).toBe(false)
      expect(startOut.error?.code).toBe("NOT_LEAD")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
