import { expect, test } from "bun:test"
import path from "node:path"
import {
  mergePortalOfflineDiskCache,
  portalOfflineSkillCacheKey,
  readPortalOfflineDiskBundle,
  readPortalOfflineDiskSkillDetail,
} from "../src/portal/offline-disk-cache.ts"
import { portalOfflineCacheDir } from "../src/paths.ts"

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
