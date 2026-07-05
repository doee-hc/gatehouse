import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { getRegistryStore } from "../src/registry/context.ts"
import { retroRecordTool } from "../src/tools/retro.ts"
import { skillExtractRecordTool } from "../src/tools/skill-extract-record.ts"
import { curatorSkillSummaryRelPath, retroSummaryRelPath } from "../src/paths.ts"
import { writeExtractManifest } from "../src/missions/manifest/store.ts"
import { RETRO_ANALYST_AGENT } from "../src/registry/types.ts"

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

function toolOutput(result: Awaited<ReturnType<ReturnType<typeof retroRecordTool>["execute"]>>) {
  return typeof result === "string" ? result : result.output
}

describe("record tools", () => {
  test("retro_record requires retro-analyst session and retro-summary report", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-record-retro-"))
    try {
      const pluginInput = { directory: dir, client: {} } as unknown as PluginInput
      const store = await getRegistryStore(pluginInput)
      const missionId = "m1"
      store.registerInnerNode({
        missionId,
        nodeId: "node-root",
        sessionId: "ses_inner",
        profile: "build",
      })
      store.registerRetroAnalyst({
        missionId,
        sessionId: "ses_retro",
      })
      const record = retroRecordTool(pluginInput)
      store.beginRetroRun(missionId)

      const missingReport = toolOutput(
        await record.execute({}, mockToolContext(dir, "ses_retro", RETRO_ANALYST_AGENT)),
      )
      expect(missingReport).toContain("REPORT_NOT_FOUND")

      const reportRel = retroSummaryRelPath(missionId)
      await Bun.write(path.join(dir, reportRel), "# retro summary\n")
      const ok = toolOutput(await record.execute({}, mockToolContext(dir, "ses_retro", RETRO_ANALYST_AGENT)))
      expect(ok).toContain("ok")
      expect(ok).toContain("retro-summary.md")

      const inner = toolOutput(await record.execute({}, mockToolContext(dir, "ses_inner", "build")))
      expect(inner).toContain("NOT_RETRO_ANALYST")

      const wrongAgent = toolOutput(await record.execute({}, mockToolContext(dir, "ses_retro", "build")))
      expect(wrongAgent).toContain("NOT_RETRO_ANALYST")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("skill_extract_record uses caller session node and requires skill extract kickoff", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-record-skill-"))
    try {
      const pluginInput = {
        directory: dir,
        client: {
          session: {
            async create() {
              return { id: "ses_verify" }
            },
          },
        },
      } as unknown as PluginInput
      const store = await getRegistryStore(pluginInput)
      const missionId = "m1"
      const nodeId = "node-doc"
      store.registerExtractNode({
        missionId,
        nodeId,
        sessionId: "ses_extract",
        profile: "build-extract",
      })
      await writeExtractManifest(dir, {
        mission_id: missionId,
        created_at: new Date().toISOString(),
        extract_order: [nodeId],
        nodes: {
          [nodeId]: {
            exec_session_id: "ses_inner",
            extract_session_id: "ses_extract",
            skill_domain: "docs",
          },
        },
      })
      store.beginSkillExtractRun(missionId, [nodeId])
      const record = skillExtractRecordTool(pluginInput)
      const summaryRel = curatorSkillSummaryRelPath(missionId, nodeId)
      await Bun.write(path.join(dir, summaryRel), "# extract\n")
      const ok = toolOutput(await record.execute({}, mockToolContext(dir, "ses_extract", "build-extract")))
      expect(ok).toContain("ok")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
