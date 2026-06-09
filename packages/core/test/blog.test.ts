import { afterEach, beforeEach, expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { buildBlogSnapshot, clearBlogCacheForTests } from "../src/portal/blog.ts"
import { publishBlogPost, readBlogPublishedRevision, unpublishBlogPost } from "../src/portal/blog-publish.ts"
import { requestPortalBlogCacheRefresh } from "../src/portal/blog-cache-sync.ts"

let dir: string

beforeEach(async () => {
  clearBlogCacheForTests()
  dir = await mkdtemp(path.join(tmpdir(), "gh-blog-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function write(rel: string, content: string) {
  const abs = path.join(dir, rel)
  await Bun.write(abs, content)
  return abs
}

test("buildBlogSnapshot groups mission posts flat and includes running mission posts", async () => {
  await write(
    ".gatehouse/lead/missions.yaml",
    `schema_version: 1
missions:
  - id: mission-old
    status: done
    objective: "旧任务"
    completed_at: "2026-05-20T10:00:00Z"
  - id: mission-new
    status: done
    objective: "新任务"
    completed_at: "2026-05-28T10:00:00Z"
  - id: mission-running
    status: running
    objective: "进行中"
`,
  )

  await write(
    ".gatehouse/trees/mission-old/manifest.yaml",
    `mission_id: mission-old
status: archived
root_node: root
created_at: "2026-05-18T00:00:00Z"
archived_at: "2026-05-20T12:00:00Z"
nodes:
  root:
    session_id: ses_root
    parent: null
    display_name: 任务协调者
  leaf-a:
    session_id: ses_a
    parent: root
    display_name: 文档工程师
`,
  )

  await write(
    ".gatehouse/trees/mission-new/manifest.yaml",
    `mission_id: mission-new
status: archived
root_node: root
created_at: "2026-05-26T00:00:00Z"
archived_at: "2026-05-28T12:00:00Z"
nodes:
  root:
    session_id: ses_root2
    parent: null
    display_name: 任务协调者
  leaf-b:
    session_id: ses_b
    parent: root
    display_name: 验证工程师
`,
  )

  await write(".gatehouse/lead/reports/mission-old/report.md", "# 旧任务验收\n\nlead 汇报。")
  await write(".gatehouse/trees/mission-old/reports/architect-summary.md", "# 旧任务复盘\n\narchitect 汇总。")
  await write(".gatehouse/trees/mission-old/reports/root-delivery.md", "# 任务协调者交付\n\n交付完成。")
  await write(
    ".gatehouse/trees/mission-old/reports/nodes/leaf-a-retro.md",
    "# leaf-a 复盘\n\n叶子 retro。",
  )

  await write(".gatehouse/lead/reports/mission-new/report.md", "# 新任务验收\n\n最新汇报。")
  await write(".gatehouse/trees/mission-new/reports/nodes/leaf-b-retro.md", "# leaf-b 复盘\n\n最新 retro。")
  await write(".gatehouse/lead/reports/mission-running/report.md", "# 进行中汇报\n\nrunning。")

  await publishBlogPost(dir, {
    postId: "mission-new:lead:report",
    reportPath: ".gatehouse/lead/reports/mission-new/report.md",
  })
  await publishBlogPost(dir, {
    postId: "mission-new:retro:leaf-b",
    reportPath: ".gatehouse/trees/mission-new/reports/nodes/leaf-b-retro.md",
  })
  await publishBlogPost(dir, {
    postId: "mission-old:lead:report",
    reportPath: ".gatehouse/lead/reports/mission-old/report.md",
  })
  await publishBlogPost(dir, {
    postId: "mission-old:architect:summary",
    reportPath: ".gatehouse/trees/mission-old/reports/architect-summary.md",
  })
  await publishBlogPost(dir, {
    postId: "mission-old:root:delivery",
    reportPath: ".gatehouse/trees/mission-old/reports/root-delivery.md",
  })
  await publishBlogPost(dir, {
    postId: "mission-old:retro:leaf-a",
    reportPath: ".gatehouse/trees/mission-old/reports/nodes/leaf-a-retro.md",
  })
  await publishBlogPost(dir, {
    postId: "mission-running:lead:report",
    reportPath: ".gatehouse/lead/reports/mission-running/report.md",
  })

  const blog = await buildBlogSnapshot(dir)

  expect(blog.groups.map((group) => [group.kind, group.id])).toEqual([
    ["mission", "mission-new"],
    ["mission", "mission-old"],
    ["mission", "mission-running"],
  ])
  expect(blog.groups[0]?.expanded).toBe(true)
  expect(blog.groups[0]?.posts.map((post) => post.title)).toEqual(["新任务验收", "leaf-b 复盘"])

  const old = blog.groups.find((group) => group.id === "mission-old")
  expect(old?.posts.map((post) => post.title)).toEqual([
    "旧任务验收",
    "旧任务复盘",
    "任务协调者交付",
    "leaf-a 复盘",
  ])

  const running = blog.groups.find((group) => group.id === "mission-running")
  expect(running?.posts[0]?.title).toBe("进行中汇报")
})

test("buildBlogSnapshot hides unpublished markdown", async () => {
  await write(
    ".gatehouse/lead/missions.yaml",
    `schema_version: 1
missions:
  - id: mission-draft
    status: done
    completed_at: "2026-05-28T10:00:00Z"
`,
  )
  await write(".gatehouse/lead/reports/mission-draft/report.md", "# 未发布\n\n不应出现在 UI。")

  const blog = await buildBlogSnapshot(dir)
  expect(blog.groups).toHaveLength(0)
})

test("buildBlogSnapshot puts skills and orphan lead reports in team building", async () => {
  await write(".gatehouse/lead/reports/standalone/report.md", "# 无 Mission 汇报\n\n团队建设正文。")
  await write(
    ".gatehouse/skills/by-domain/dft-handoff/dft-handoff-engineer/SKILL.md",
    "# dft-handoff-engineer\n\nhandoff skill 正文。",
  )
  await publishBlogPost(dir, {
    postId: "standalone:lead:report",
    reportPath: ".gatehouse/lead/reports/standalone/report.md",
  })
  await publishBlogPost(dir, {
    postId: "skill:dft-handoff:dft-handoff-engineer",
    reportPath: ".gatehouse/skills/by-domain/dft-handoff/dft-handoff-engineer/SKILL.md",
  })

  const blog = await buildBlogSnapshot(dir)

  expect(blog.groups).toHaveLength(1)
  expect(blog.groups[0]?.kind).toBe("team-building")
  expect(blog.groups[0]?.expanded).toBe(true)
  expect(blog.groups[0]?.posts.map((post) => post.title).sort()).toEqual([
    "dft-handoff-engineer",
    "无 Mission 汇报",
  ])
})

test("buildBlogSnapshot hides post after unpublish", async () => {
  await write(
    ".gatehouse/lead/missions.yaml",
    `schema_version: 1
missions:
  - id: m1
    status: done
    completed_at: "2026-05-01T00:00:00Z"
`,
  )
  await write(".gatehouse/lead/reports/m1/report.md", "# 报告\n\n正文。")
  await publishBlogPost(dir, {
    postId: "m1:lead:report",
    reportPath: ".gatehouse/lead/reports/m1/report.md",
    publishedBy: "lead",
  })
  expect((await buildBlogSnapshot(dir)).groups).toHaveLength(1)

  await unpublishBlogPost(dir, { postId: "m1:lead:report", actor: "lead" })
  expect((await buildBlogSnapshot(dir)).groups).toHaveLength(0)
})

test("buildBlogSnapshot omits missions with no published posts", async () => {
  await write(
    ".gatehouse/lead/missions.yaml",
    `schema_version: 1
missions:
  - id: empty-done
    status: done
    completed_at: "2026-05-01T00:00:00Z"
`,
  )

  const blog = await buildBlogSnapshot(dir)
  expect(blog.groups).toHaveLength(0)
})

test("buildBlogSnapshot reloads when blog-published revision changes", async () => {
  await write(
    ".gatehouse/lead/missions.yaml",
    `schema_version: 1
missions:
  - id: m-rev
    status: done
    completed_at: "2026-05-01T00:00:00Z"
`,
  )
  await write(".gatehouse/lead/reports/m-rev/report.md", "# 报告\n\n正文。")

  expect((await buildBlogSnapshot(dir)).groups).toHaveLength(0)

  await write(
    ".gatehouse/portal/blog-published.yaml",
    `schema_version: 1
posts:
  - id: m-rev:lead:report
    path: .gatehouse/lead/reports/m-rev/report.md
    published_at: "2026-06-01T00:00:00Z"
    published_by: lead
`,
  )

  expect((await readBlogPublishedRevision(dir))).not.toBe("0")
  expect((await buildBlogSnapshot(dir)).groups).toHaveLength(1)
})

test("requestPortalBlogCacheRefresh hits portal internal endpoint", async () => {
  const port = String(18200 + Math.floor(Math.random() * 500))
  const token = "blog-cache-refresh-token"
  let invalidated = false

  const server = Bun.serve({
    port: Number(port),
    hostname: "127.0.0.1",
    fetch: async (request) => {
      if (new URL(request.url).pathname !== "/portal/api/internal/blog-invalidate") {
        return new Response("not found", { status: 404 })
      }
      if (request.headers.get("X-Gatehouse-Portal-Internal-Token") !== token) {
        return new Response("unauthorized", { status: 401 })
      }
      invalidated = true
      return Response.json({ ok: true })
    },
  })

  process.env.GATEHOUSE_PORTAL_PORT = port
  process.env.GATEHOUSE_PORTAL_INTERNAL_TOKEN = token

  expect(await requestPortalBlogCacheRefresh(dir)).toBe(true)
  expect(invalidated).toBe(true)

  server.stop()
  delete process.env.GATEHOUSE_PORTAL_PORT
  delete process.env.GATEHOUSE_PORTAL_INTERNAL_TOKEN
})
