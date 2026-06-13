import { afterEach, beforeEach, expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { readBlogPublishedDocument } from "../src/portal/blog-publish.ts"
import { unpublishBlogTool } from "../src/tools/unpublish-blog.ts"
import { submitDeliveryRecord } from "../src/delivery/store.ts"
import { parseMissionsFile } from "../src/missions/parse.ts"
import { missionCompleteTool } from "../src/tools/mission-complete.ts"

let dir: string

function mockToolContext(directory: string, sessionID: string, agent = "build-root"): ToolContext {
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

function toolOutput(result: Awaited<ReturnType<ReturnType<typeof unpublishBlogTool>["execute"]>>) {
  return typeof result === "string" ? result : result.output
}

async function writeMissions(missionId: string, doneWhen: unknown[]) {
  await Bun.write(
    path.join(dir, ".gatehouse", "lead", "missions.yaml"),
    `schema_version: 2
missions:
  - id: ${missionId}
    status: running
    objective: "demo"
    done_when:
${doneWhen.map((item) => `      - ${JSON.stringify(item)}`).join("\n")}
    must_not: []
`,
  )
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "gh-publish-blog-tool-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

test("mission_complete done publishes deliverables; lead may unpublish", async () => {
  const missionId = "m1"
  const rel = "content/post.md"
  await writeMissions(missionId, [{ publish: rel }])
  await Bun.write(path.join(dir, rel), "# Post\n\nBody.")

  const pluginInput = {
    directory: dir,
    client: {
      session: {
        async promptAsync() {},
        async messages() {
          return { data: [] }
        },
        async get() {
          return { data: {} }
        },
        async status() {
          return { data: { ses_root: { type: "idle" }, ses_lead: { type: "idle" } } }
        },
      },
    },
  } as unknown as PluginInput

  const { getRegistryStore } = await import("../src/registry/context.ts")
  const store = await getRegistryStore(pluginInput)
  store.registerOuterSession({ sessionId: "ses_lead", profile: "lead" })
  store.register({
    agentId: `inner:${missionId}:root`,
    scope: "inner",
    profile: "build-root",
    sessionId: "ses_root",
    displayName: "root",
    missionId,
    nodeId: "root",
    status: "active",
  })
  store.activateMission({
    missionId,
    status: "running",
    doneWhen: [],
    mustNot: [],
    isActive: true,
    lockedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  const complete = missionCompleteTool(pluginInput)
  const unpublish = unpublishBlogTool(pluginInput)
  const leadCtx = mockToolContext(dir, "ses_lead", "lead")

  const mission = parseMissionsFile(await Bun.file(path.join(dir, ".gatehouse", "lead", "missions.yaml")).text())
    .missions[0]!
  await submitDeliveryRecord({
    projectDirectory: dir,
    missionId,
    submittedByNode: "root",
    summary: "done",
    missionEntry: mission,
  })
  expect((await readBlogPublishedDocument(dir)).posts).toHaveLength(0)
  expect(
    toolOutput(
      await complete.execute(
        { mission_id: missionId, status: "done", publish_deliverables: true },
        leadCtx,
      ),
    ),
  ).toContain("ok")
  expect((await readBlogPublishedDocument(dir)).posts).toHaveLength(1)

  expect(toolOutput(await unpublish.execute({ mission_id: missionId, report_path: rel }, leadCtx))).toContain("ok")
  expect((await readBlogPublishedDocument(dir)).posts).toHaveLength(0)
})

test("unpublish_blog rejects non-lead callers", async () => {
  const pluginInput = { directory: dir, client: {} } as unknown as PluginInput
  const unpublish = unpublishBlogTool(pluginInput)
  const { getRegistryStore } = await import("../src/registry/context.ts")
  const store = await getRegistryStore(pluginInput)
  store.register({
    agentId: "inner:m1:root",
    scope: "inner",
    profile: "build-root",
    sessionId: "ses_root",
    displayName: "root",
    missionId: "m1",
    nodeId: "root",
    status: "active",
  })

  const result = toolOutput(
    await unpublish.execute({ report_path: "content/post.md" }, mockToolContext(dir, "ses_root")),
  )
  expect(result).toContain("NOT_LEAD")
})
