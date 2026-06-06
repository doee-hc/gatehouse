import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { missionStartTool } from "../src/tools/mission-start.ts"
import { missionCurrentTool } from "../src/tools/mission-current.ts"
import { parseMissionsFile } from "../src/missions/parse.ts"
import { getRegistryStore } from "../src/registry/context.ts"
import { OUTER_LEAD_ID, OUTER_ARCHITECT_ID } from "../src/registry/types.ts"
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
  test("starts queued mission, registers snapshot, mission_current returns full contract", async () => {
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

      const currentOut = JSON.parse(
        toolOutput(await missionCurrentTool(pluginInput).execute({}, mockToolContext(dir, "ses_architect", "architect"))),
      ) as {
        ok: boolean
        data?: { mission_id: string; objective?: string; done_when: string[]; must_not: string[] }
      }
      expect(currentOut.ok).toBe(true)
      expect(currentOut.data?.mission_id).toBe("core-example-smoke-v1")
      expect((currentOut.data?.done_when.length ?? 0) > 0).toBe(true)
      expect((currentOut.data?.must_not.length ?? 0) > 0).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
