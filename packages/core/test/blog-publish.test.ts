import { afterEach, beforeEach, expect, test } from "bun:test"
import path from "node:path"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import {
  blogMissionIdFromPostId,
  blogPostRelPath,
  publishBlogPost,
  readBlogPublishedDocument,
  resolveBlogPostId,
  unpublishBlogPost,
} from "../src/portal/blog-publish.ts"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "gh-blog-publish-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

test("resolveBlogPostId only maps skill paths", () => {
  expect(resolveBlogPostId(".gatehouse/lead/reports/m1/report.md")).toBeUndefined()
  expect(resolveBlogPostId(".gatehouse/trees/m1/reports/root-delivery.md")).toBeUndefined()
  expect(resolveBlogPostId(".gatehouse/skills/by-domain/dft/x/SKILL.md")).toBe("skill:dft:x")
})

test("blogMissionIdFromPostId extracts mission id", () => {
  expect(blogMissionIdFromPostId("m1:lead:report")).toBe("m1")
  expect(blogMissionIdFromPostId("m1:retro:summary")).toBe("m1")
  expect(blogMissionIdFromPostId("skill:dft:x")).toBeUndefined()
})

test("blogPostRelPath inverts post ids", () => {
  expect(blogPostRelPath("m1:lead:report")).toBe(".gatehouse/lead/reports/m1/report.md")
  expect(blogPostRelPath("m1:retro:summary")).toBe(".gatehouse/trees/m1/reports/retro-summary.md")
})

test("publishBlogPost writes manifest and supports republish", async () => {
  const rel = ".gatehouse/lead/reports/m1/report.md"
  await Bun.write(path.join(dir, rel), "# 标题\n\n正文。")

  const first = await publishBlogPost(dir, { postId: "m1:lead:report", reportPath: rel, publishedBy: "lead" })
  expect(first.republished).toBe(false)

  const doc = await readBlogPublishedDocument(dir)
  expect(doc.posts).toHaveLength(1)
  expect(doc.posts[0]?.published_by).toBe("lead")

  const second = await publishBlogPost(dir, { postId: "m1:lead:report", reportPath: rel })
  expect(second.republished).toBe(true)
  expect((await readBlogPublishedDocument(dir)).posts).toHaveLength(1)
})

test("unpublishBlogPost removes entry for owner only", async () => {
  const rel = ".gatehouse/lead/reports/m1/report.md"
  await Bun.write(path.join(dir, rel), "# 标题\n\n正文。")
  await publishBlogPost(dir, { postId: "m1:lead:report", reportPath: rel, publishedBy: "lead" })

  expect(await unpublishBlogPost(dir, { postId: "m1:lead:report", actor: "architect" })).toEqual({
    ok: false,
    code: "NOT_OWNER",
    published_by: "lead",
  })
  expect((await readBlogPublishedDocument(dir)).posts).toHaveLength(1)

  const removed = await unpublishBlogPost(dir, { postId: "m1:lead:report", actor: "lead" })
  expect(removed.ok).toBe(true)
  if (removed.ok) {
    expect(removed.post_id).toBe("m1:lead:report")
    expect(removed.path).toBe(rel)
  }
  expect((await readBlogPublishedDocument(dir)).posts).toHaveLength(0)

  expect(await unpublishBlogPost(dir, { postId: "m1:lead:report", actor: "lead" })).toEqual({
    ok: false,
    code: "NOT_PUBLISHED",
  })
})

test("unpublishBlogPost allows lead to remove legacy posts without published_by", async () => {
  const rel = ".gatehouse/lead/reports/m1/report.md"
  const manifest = path.join(dir, ".gatehouse", "portal", "blog-published.yaml")
  await mkdir(path.dirname(manifest), { recursive: true })
  await Bun.write(
    manifest,
    `schema_version: 1
posts:
  - id: m1:lead:report
    path: ${rel}
    published_at: "2026-01-01T00:00:00.000Z"
`,
  )

  const removed = await unpublishBlogPost(dir, { postId: "m1:lead:report", actor: "lead" })
  expect(removed.ok).toBe(true)
  expect((await readBlogPublishedDocument(dir)).posts).toHaveLength(0)
})
