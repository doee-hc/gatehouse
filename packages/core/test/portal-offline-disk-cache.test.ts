import { expect, test } from "bun:test"
import path from "node:path"
import { utimes } from "node:fs/promises"
import { buildBlogSnapshot, clearBlogCacheForTests } from "../src/portal/blog.ts"
import { publishBlogPost } from "../src/portal/blog-publish.ts"
import {
  clearPortalOfflineRefreshStateForTests,
  ensurePortalOfflineDiskContent,
  exportPortalOfflineStaticCache,
  mergePortalOfflineDiskCache,
  portalOfflineContentTtlMs,
  portalOfflineSkillCacheKey,
  portalStaticOfflineCacheExportDirs,
  readPortalOfflineDiskBundle,
  readPortalOfflineDiskManifest,
  readPortalOfflineDiskSkillDetail,
  refreshPortalOfflineContentCache,
} from "../src/portal/offline-disk-cache.ts"
import { clearSkillDetailCacheForTests } from "../src/portal/skill.ts"
import { portalOfflineCacheDir, portalStaticOfflineCacheDir } from "../src/paths.ts"

const dir = path.join(import.meta.dir, ".tmp-offline-disk-cache")

test("mergePortalOfflineDiskCache writes bundle and skill details", async () => {
  await Bun.$`rm -rf ${dir} && mkdir -p ${dir}/.gatehouse/portal/cache`.quiet()

  await mergePortalOfflineDiskCache(dir, {
    snapshot: {
      project: "demo",
      updated_at: "2026-06-14T00:00:00.000Z",
      missions: [],
      agents: [],
      skills: [{ name: "lint", domain: "quality", path: ".gatehouse/skills/by-domain/quality/lint/SKILL.md" }],
    },
    blog: {
      project: "demo",
      updated_at: "2026-06-14T00:00:00.000Z",
      groups: [],
    },
    teamStats: {
      project: "demo",
      updated_at: "2026-06-14T00:00:00.000Z",
      opencode_reachable: true,
      outer: [],
      missions: [],
    },
    skills: {
      [portalOfflineSkillCacheKey("quality", "lint")]: {
        name: "lint",
        domain: "quality",
        path: ".gatehouse/skills/by-domain/quality/lint/SKILL.md",
        markdown: "# Lint\n",
      },
    },
  })

  const bundle = await readPortalOfflineDiskBundle(dir)
  expect(bundle?.snapshot?.project).toBe("demo")
  expect(bundle?.blog?.groups).toEqual([])
  expect(bundle?.teamStats?.missions).toEqual([])
  expect(bundle?.skills?.[portalOfflineSkillCacheKey("quality", "lint")]?.markdown).toBe("# Lint\n")

  const skill = await readPortalOfflineDiskSkillDetail(dir, "quality", "lint")
  expect(skill?.name).toBe("lint")
  expect(await Bun.file(path.join(portalOfflineCacheDir(dir), "manifest.json")).exists()).toBe(true)
})

test("mergePortalOfflineDiskCache merges skill patches without dropping snapshot", async () => {
  await Bun.$`rm -rf ${dir} && mkdir -p ${dir}/.gatehouse/portal/cache`.quiet()

  await mergePortalOfflineDiskCache(dir, {
    snapshot: {
      project: "demo",
      updated_at: "2026-06-14T00:00:00.000Z",
      missions: [],
      agents: [],
      skills: [],
    },
  })

  await mergePortalOfflineDiskCache(dir, {
    skills: {
      [portalOfflineSkillCacheKey("docs", "write")]: {
        name: "write",
        domain: "docs",
        path: ".gatehouse/skills/by-domain/docs/write/SKILL.md",
        markdown: "# Write\n",
      },
    },
  })

  const bundle = await readPortalOfflineDiskBundle(dir)
  expect(bundle?.snapshot?.project).toBe("demo")
  expect(bundle?.skills?.[portalOfflineSkillCacheKey("docs", "write")]?.markdown).toBe("# Write\n")
})

test("refreshPortalOfflineContentCache writes blog markdown and skill bodies", async () => {
  clearBlogCacheForTests()
  await Bun.$`rm -rf ${dir} && mkdir -p ${dir}/.gatehouse/portal/cache ${dir}/.gatehouse/skills/by-domain/docs/write ${dir}/.gatehouse/lead`.quiet()

  await Bun.write(
    path.join(dir, ".gatehouse/skills/by-domain/docs/write/SKILL.md"),
    "# Write Skill\n\nBody",
  )
  await Bun.write(path.join(dir, ".gatehouse/lead/missions.yaml"), "schema_version: 2\nmissions: []\n")
  await Bun.write(path.join(dir, "posts/hello.md"), "# Hello\n\nBlog body")
  await publishBlogPost(dir, { postId: "team:hello", reportPath: "posts/hello.md" })

  await mergePortalOfflineDiskCache(dir, {
    snapshot: {
      project: "demo",
      updated_at: "2026-06-14T00:00:00.000Z",
      missions: [],
      agents: [],
      skills: [{ name: "write", domain: "docs", path: ".gatehouse/skills/by-domain/docs/write/SKILL.md" }],
    },
  })

  await refreshPortalOfflineContentCache(
    dir,
    [{ name: "write", domain: "docs", path: ".gatehouse/skills/by-domain/docs/write/SKILL.md" }],
    { force: true },
  )

  const bundle = await readPortalOfflineDiskBundle(dir)
  expect(bundle?.skills?.[portalOfflineSkillCacheKey("docs", "write")]?.markdown).toContain("# Write Skill")
  expect(bundle?.blog?.groups.some((group) => group.posts.some((post) => post.markdown.includes("Blog body")))).toBe(
    true,
  )

  const ensured = await ensurePortalOfflineDiskContent(dir, bundle!.snapshot!)
  expect(ensured?.blog?.groups.some((group) => group.posts.some((post) => post.markdown.includes("Blog body")))).toBe(
    true,
  )
  expect((await buildBlogSnapshot(dir)).groups.length > 0).toBe(true)
})

test("refreshPortalOfflineContentCache skips work within TTL when content is complete", async () => {
  clearBlogCacheForTests()
  clearSkillDetailCacheForTests()
  clearPortalOfflineRefreshStateForTests()

  const previousTtl = process.env.GATEHOUSE_PORTAL_OFFLINE_CONTENT_TTL_MS
  process.env.GATEHOUSE_PORTAL_OFFLINE_CONTENT_TTL_MS = String(60_000)

  try {
    await Bun.$`rm -rf ${dir} && mkdir -p ${dir}/.gatehouse/portal/cache ${dir}/.gatehouse/skills/by-domain/docs/write ${dir}/.gatehouse/lead`.quiet()
    await Bun.write(
      path.join(dir, ".gatehouse/skills/by-domain/docs/write/SKILL.md"),
      "# Write Skill\n\nBody",
    )
    await Bun.write(path.join(dir, ".gatehouse/lead/missions.yaml"), "schema_version: 2\nmissions: []\n")

    const skills = [{ name: "write", domain: "docs", path: ".gatehouse/skills/by-domain/docs/write/SKILL.md" }]
    await mergePortalOfflineDiskCache(dir, {
      snapshot: {
        project: "demo",
        updated_at: "2026-06-14T00:00:00.000Z",
        missions: [],
        agents: [],
        skills,
      },
    })
    await refreshPortalOfflineContentCache(dir, skills, { force: true })

    const before = await readPortalOfflineDiskManifest(dir)
    await refreshPortalOfflineContentCache(dir, skills)
    const after = await readPortalOfflineDiskManifest(dir)

    expect(before?.content?.refreshedAt).toBe(after?.content?.refreshedAt)
    expect(portalOfflineContentTtlMs()).toBe(60_000)
  } finally {
    if (previousTtl === undefined) delete process.env.GATEHOUSE_PORTAL_OFFLINE_CONTENT_TTL_MS
    else process.env.GATEHOUSE_PORTAL_OFFLINE_CONTENT_TTL_MS = previousTtl
    clearPortalOfflineRefreshStateForTests()
  }
})

test("refreshPortalOfflineContentCache incrementally updates changed skill files", async () => {
  clearSkillDetailCacheForTests()
  clearPortalOfflineRefreshStateForTests()

  await Bun.$`rm -rf ${dir} && mkdir -p ${dir}/.gatehouse/portal/cache ${dir}/.gatehouse/skills/by-domain/docs/write ${dir}/.gatehouse/lead`.quiet()
  const skillPath = path.join(dir, ".gatehouse/skills/by-domain/docs/write/SKILL.md")
  await Bun.write(skillPath, "# Version 1\n")
  await Bun.write(path.join(dir, ".gatehouse/lead/missions.yaml"), "schema_version: 2\nmissions: []\n")

  const skills = [{ name: "write", domain: "docs", path: ".gatehouse/skills/by-domain/docs/write/SKILL.md" }]
  await refreshPortalOfflineContentCache(dir, skills, { force: true })

  await Bun.write(skillPath, "# Version 2\n")
  clearSkillDetailCacheForTests()
  const bumped = Date.now() / 1000 + 2
  await utimes(skillPath, bumped, bumped)
  await refreshPortalOfflineContentCache(dir, skills, { force: true })

  const bundle = await readPortalOfflineDiskBundle(dir)
  expect(bundle?.skills?.[portalOfflineSkillCacheKey("docs", "write")]?.markdown).toBe("# Version 2\n")
})

test("mergePortalOfflineDiskCache exports browser bundle to static-cache", async () => {
  const exportDir = path.join(dir, ".export-static-cache")
  const prev = process.env.GATEHOUSE_PORTAL_STATIC_CACHE_DIR
  process.env.GATEHOUSE_PORTAL_STATIC_CACHE_DIR = exportDir

  try {
    await Bun.$`rm -rf ${dir} ${exportDir} && mkdir -p ${dir}/.gatehouse/portal/cache`.quiet()

    await mergePortalOfflineDiskCache(dir, {
      snapshot: {
        project: "demo",
        updated_at: "2026-06-14T00:00:00.000Z",
        missions: [],
        agents: [],
        skills: [],
      },
    })
    await exportPortalOfflineStaticCache(dir)

    const projectStatic = path.join(portalStaticOfflineCacheDir(dir), "bundle.json")
    const envStatic = path.join(exportDir, "bundle.json")
    expect(await Bun.file(projectStatic).exists()).toBe(true)
    expect(await Bun.file(envStatic).exists()).toBe(true)

    const exported = (await Bun.file(projectStatic).json()) as { snapshot?: { project?: string } }
    expect(exported.snapshot?.project).toBe("demo")

    await exportPortalOfflineStaticCache(dir)
    expect(portalStaticOfflineCacheExportDirs(dir)).toEqual([
      path.resolve(portalStaticOfflineCacheDir(dir)),
      path.resolve(exportDir),
    ])
  } finally {
    if (prev === undefined) delete process.env.GATEHOUSE_PORTAL_STATIC_CACHE_DIR
    else process.env.GATEHOUSE_PORTAL_STATIC_CACHE_DIR = prev
  }
})
