import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { getRegistryStore } from "../src/registry/context.ts"
import { retroRecordTool } from "../src/tools/retro.ts"
import { skillExtractRecordTool } from "../src/tools/skill-extract-record.ts"
import { curatorSkillSummaryRelPath, retroNodeReportRelPath } from "../src/paths.ts"
import { writeExtractManifest } from "../src/tree/store.ts"

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
  test("retro_record uses caller session node and requires retro run membership", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-record-retro-"))
    try {
      const pluginInput = { directory: dir, client: {} } as unknown as PluginInput
      const store = await getRegistryStore(pluginInput)
      const missionId = "m1"
      const nodeId = "node-root"
      store.registerInnerNode({
        missionId,
        nodeId,
        sessionId: "ses_inner",
        profile: "build",
      })
      store.registerRetroNode({
        missionId,
        nodeId,
        sessionId: "ses_retro",
        profile: "build-coordinator",
      })
      const record = retroRecordTool(pluginInput)

      store.beginRetroRun(missionId, ["other-node"])
      const rejected = toolOutput(await record.execute({}, mockToolContext(dir, "ses_retro", "build-coordinator")))
      expect(rejected).toContain("NODE_NOT_IN_RETRO_RUN")

      store.beginRetroRun(missionId, [nodeId])
      const reportRel = retroNodeReportRelPath(missionId, nodeId)
      await Bun.write(path.join(dir, reportRel), "# retro\n")
      const ok = toolOutput(await record.execute({}, mockToolContext(dir, "ses_retro", "build-coordinator")))
      expect(ok).toContain("ok")
      expect(ok).toContain(nodeId)

      const inner = toolOutput(await record.execute({}, mockToolContext(dir, "ses_inner", "build")))
      expect(inner).toContain("NOT_RETRO_SESSION")
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
      store.registerExtractNode({
        missionId,
        nodeId: "node-other",
        sessionId: "ses_other_extract",
        profile: "build-extract",
      })
      await writeExtractManifest(dir, {
        mission_id: missionId,
        created_at: new Date().toISOString(),
        extract_order: [nodeId],
        nodes: {
          [nodeId]: {
            exec_session_id: "ses_doc",
            extract_session_id: "ses_extract",
            skill_domain: "docs",
          },
        },
      })
      store.beginSkillExtractRun(missionId, [nodeId])
      const summaryRel = curatorSkillSummaryRelPath(missionId, nodeId)
      await Bun.write(path.join(dir, summaryRel), "# extract\n")

      const record = skillExtractRecordTool(pluginInput)
      const ok = toolOutput(await record.execute({}, mockToolContext(dir, "ses_extract", "build-extract")))
      expect(ok).toContain("ok")
      expect(ok).toContain(nodeId)

      const rejected = toolOutput(await record.execute({}, mockToolContext(dir, "ses_other_extract", "build-extract")))
      expect(rejected).toContain("NODE_NOT_IN_SKILL_EXTRACT_RUN")

      const innerRejected = toolOutput(await record.execute({}, mockToolContext(dir, "ses_doc", "build")))
      expect(innerRejected).toContain("NOT_EXTRACT_SESSION")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
