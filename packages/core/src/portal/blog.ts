import path from "node:path"
import { leadDir } from "../paths.ts"
import { readManifest } from "../tree/store.ts"
import type { TreeManifest } from "../tree/types.ts"
import { isRecord, parseYaml, readString } from "../yaml.ts"
import {
  blogPostFormatFromPath,
  excerptFromBlogPost,
  extractBlogPostTitle,
  type BlogPostFormat,
} from "./blog-content.ts"
import {
  blogMissionIdFromPostId,
  readBlogPublishedDocument,
  readBlogPublishedRevision,
  readPublishedBlogPostIds,
} from "./blog-publish.ts"
import { createPortalDataCache } from "./portal-cache.ts"
import { getPortalDisplaySettings } from "./portal-display-settings.ts"

export type BlogPost = {
  id: string
  title: string
  excerpt: string
  format: BlogPostFormat
  markdown: string
  path: string
  updated_at: string
}

export type BlogGroup = {
  kind: "mission" | "team-building"
  id: string
  title: string
  objective?: string
  completed_at?: string
  post_count: number
  expanded: boolean
  posts: BlogPost[]
}

export type BlogSnapshot = {
  project_directory: string
  updated_at: string
  groups: BlogGroup[]
}

type MissionEntry = {
  id: string
  status: string
  objective?: string
  completed_at?: string
}

const TEAM_BUILDING_GROUP_ID = "__team_building__"

async function readMissionEntries(projectDirectory: string) {
  const file = Bun.file(path.join(leadDir(projectDirectory), "missions.yaml"))
  if (!(await file.exists())) return [] as MissionEntry[]
  const raw = parseYaml(await file.text())
  if (!isRecord(raw) || !Array.isArray(raw.missions)) return []
  return raw.missions.flatMap((entry): MissionEntry[] => {
    if (!isRecord(entry)) return []
    const id = readString(entry.id)
    const status = readString(entry.status)
    if (!id || !status) return []
    return [
      {
        id,
        status,
        ...(readString(entry.objective) && { objective: readString(entry.objective) }),
        ...(readString(entry.completed_at) && { completed_at: readString(entry.completed_at) }),
      },
    ]
  })
}

async function readPublishedPost(projectDirectory: string, relPath: string, postId: string) {
  const abs = path.join(projectDirectory, relPath)
  const file = Bun.file(abs)
  if (!(await file.exists())) return undefined
  const markdown = await file.text()
  if (!markdown.trim()) return undefined
  const stat = await file.stat()
  const format = blogPostFormatFromPath(relPath)
  const fallback = path.basename(relPath)
  return {
    id: postId,
    title: extractBlogPostTitle(markdown, format, fallback),
    excerpt: excerptFromBlogPost(markdown, format),
    format,
    markdown,
    path: relPath,
    updated_at: stat.mtime.toISOString(),
  } satisfies BlogPost
}

function blogPostSortRank(postId: string) {
  if (postId.includes(":deliverable:")) return 0
  if (postId.endsWith(":lead:report")) return 1
  if (postId.endsWith(":architect:summary")) return 2
  if (postId.endsWith(":retro:summary")) return 3
  return 99
}

function sortMissionPosts(posts: BlogPost[]) {
  return [...posts].sort(
    (a, b) => blogPostSortRank(a.id) - blogPostSortRank(b.id) || a.title.localeCompare(b.title),
  )
}

function missionSortTime(mission: MissionEntry, manifest?: TreeManifest) {
  if (mission.completed_at) return mission.completed_at
  if (manifest?.archived_at) return manifest.archived_at
  return manifest?.created_at ?? ""
}

async function readPublishedPosts(projectDirectory: string, published: Set<string>) {
  const doc = await readBlogPublishedDocument(projectDirectory)
  const posts: BlogPost[] = []
  for (const entry of doc.posts) {
    if (!published.has(entry.id)) continue
    const post = await readPublishedPost(projectDirectory, entry.path, entry.id)
    if (post) posts.push(post)
  }
  return posts
}

const blogSnapshotCache = createPortalDataCache<BlogSnapshot>({
  ttlMs: () => getPortalDisplaySettings().blogTtlMs,
})

async function loadBlogSnapshot(projectDirectory: string) {
  const published = await readPublishedBlogPostIds(projectDirectory)
  const posts = await readPublishedPosts(projectDirectory, published)
  const missions = await readMissionEntries(projectDirectory)
  const missionById = new Map(missions.map((mission) => [mission.id, mission]))
  const knownMissionIds = new Set(missions.map((mission) => mission.id))

  const missionPosts = new Map<string, BlogPost[]>()
  const teamBuildingPosts: BlogPost[] = []

  for (const post of posts) {
    if (post.id.startsWith("skill:")) continue
    const missionId = blogMissionIdFromPostId(post.id)
    if (!missionId || !knownMissionIds.has(missionId)) {
      teamBuildingPosts.push(post)
      continue
    }
    const bucket = missionPosts.get(missionId) ?? []
    bucket.push(post)
    missionPosts.set(missionId, bucket)
  }

  const missionGroups = await Promise.all(
    [...missionPosts.entries()].map(async ([missionId, groupPosts]) => {
      const mission = missionById.get(missionId)!
      const manifest = await readManifest(projectDirectory, missionId)
      return {
        kind: "mission" as const,
        id: missionId,
        title: missionId,
        ...(mission.objective && { objective: mission.objective }),
        sortTime: missionSortTime(mission, manifest),
        ...(mission.completed_at && { completed_at: mission.completed_at }),
        post_count: groupPosts.length,
        expanded: false,
        posts: sortMissionPosts(groupPosts),
      }
    }),
  )

  const missionBlogGroups: BlogGroup[] = missionGroups
    .filter((group) => group.post_count > 0)
    .sort((a, b) => b.sortTime.localeCompare(a.sortTime))
    .map(({ sortTime: _sortTime, ...group }) => group)

  if (missionBlogGroups.length > 0) missionBlogGroups[0]!.expanded = true

  const teamBuildingGroup: BlogGroup | undefined =
    teamBuildingPosts.length > 0
      ? {
          kind: "team-building",
          id: TEAM_BUILDING_GROUP_ID,
          title: TEAM_BUILDING_GROUP_ID,
          post_count: teamBuildingPosts.length,
          expanded: missionBlogGroups.length === 0,
          posts: [...teamBuildingPosts].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
        }
      : undefined

  const groups = [...missionBlogGroups, ...(teamBuildingGroup ? [teamBuildingGroup] : [])]

  return {
    project_directory: projectDirectory,
    updated_at: new Date().toISOString(),
    groups,
  } satisfies BlogSnapshot
}

function blogSnapshotCacheKey(projectDirectory: string, revision: string) {
  return `${projectDirectory}\0${revision}`
}

export async function buildBlogSnapshot(projectDirectory: string) {
  const revision = await readBlogPublishedRevision(projectDirectory)
  return blogSnapshotCache.get(blogSnapshotCacheKey(projectDirectory, revision), () =>
    loadBlogSnapshot(projectDirectory),
  )
}

export function invalidateBlogSnapshotCache() {
  blogSnapshotCache.clear()
}

export function clearBlogCacheForTests() {
  blogSnapshotCache.clear()
}
