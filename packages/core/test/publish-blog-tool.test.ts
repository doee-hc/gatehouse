import { afterEach, beforeEach, expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { readBlogPublishedDocument } from "../src/portal/blog-publish.ts"
import { publishBlogTool } from "../src/tools/publish-blog.ts"
import { unpublishBlogTool } from "../src/tools/unpublish-blog.ts"

let dir: string

function mockToolContext(directory: string, sessionID: string): ToolContext {
  return {
    sessionID,
    messageID: "test-message",
    agent: "lead",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata() {},
    ask() {
      throw new Error("ask not implemented in mock")
    },
  }
}

function toolOutput(result: Awaited<ReturnType<ReturnType<typeof publishBlogTool>["execute"]>>) {
  return typeof result === "string" ? result : result.output
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "gh-publish-blog-tool-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

test("publish_blog requires known report_path and writes manifest", async () => {
  const pluginInput = { directory: dir, client: {} } as unknown as PluginInput
  const rel = ".gatehouse/lead/reports/m1/report.md"
  await Bun.write(path.join(dir, rel), "# 标题\n\n正文。")
  const publish = publishBlogTool(pluginInput)

  const unknown = toolOutput(
    await publish.execute({ report_path: ".gatehouse/lead/reports/m1/wrong.md" }, mockToolContext(dir, "ses")),
  )
  expect(unknown).toContain("INVALID_BLOG_POST")

  const missing = toolOutput(
    await publish.execute({ report_path: rel }, mockToolContext(dir, "ses")),
  )
  expect(missing).toContain("ok")
  expect(missing).toContain("m1:lead:report")

  const doc = await readBlogPublishedDocument(dir)
  expect(doc.posts).toHaveLength(1)
  expect(doc.posts[0]?.path).toBe(rel)
})

test("unpublish_blog uses report_path only", async () => {
  const pluginInput = { directory: dir, client: {} } as unknown as PluginInput
  const rel = ".gatehouse/lead/reports/m1/report.md"
  await Bun.write(path.join(dir, rel), "# 标题\n\n正文。")

  const { getRegistryStore } = await import("../src/registry/context.ts")
  const store = await getRegistryStore(pluginInput)
  store.registerOuterSession({ sessionId: "ses_lead", profile: "lead" })

  const publish = publishBlogTool(pluginInput)
  const unpublish = unpublishBlogTool(pluginInput)
  const ctx = mockToolContext(dir, "ses_lead")

  const published = toolOutput(await publish.execute({ report_path: rel }, ctx))
  expect(published).toContain("ok")

  const removed = toolOutput(await unpublish.execute({ report_path: rel }, ctx))
  expect(removed).toContain("ok")
  expect((await readBlogPublishedDocument(dir)).posts).toHaveLength(0)
})
