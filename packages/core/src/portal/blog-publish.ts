import path from "node:path"
import { gatehouseRoot } from "../paths.ts"
import { isRecord, parseYaml, readString, stringifyYaml } from "../yaml.ts"
import { requestPortalBlogCacheRefresh } from "./blog-cache-sync.ts"

export async function readBlogPublishedRevision(projectDirectory: string) {
  const file = Bun.file(blogPublishedPath(projectDirectory))
  if (!(await file.exists())) return "0"
  return String((await file.stat()).mtimeMs)
}

export type BlogPublishedEntry = {
  id: string
  path: string
  published_at: string
  published_by?: string
}

export type BlogPublishedDocument = {
  schema_version: 1
  posts: BlogPublishedEntry[]
}

export function blogPublishedPath(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "portal", "blog-published.yaml")
}

export function leadBlogReportRel(missionId: string) {
  return path.join(".gatehouse", "lead", "reports", missionId, "report.md")
}

export function architectBlogSummaryRel(missionId: string) {
  return path.join(".gatehouse", "architect", "trees", missionId, "reports", "architect-summary.md")
}

export function rootBlogDeliveryRel(missionId: string) {
  return path.join(".gatehouse", "architect", "trees", missionId, "reports", "root-delivery.md")
}

export function retroBlogNodeRel(missionId: string, nodeId: string) {
  return path.join(".gatehouse", "architect", "trees", missionId, "reports", "nodes", `${nodeId}-retro.md`)
}

export function skillBlogRel(domain: string, skillName: string) {
  return path.join(".gatehouse", "skills", "by-domain", domain, skillName, "SKILL.md")
}

export function resolveBlogPostId(reportPath: string) {
  const rel = reportPath.replace(/\\/g, "/").replace(/^\.\//, "")

  const leadMatch = rel.match(/^\.gatehouse\/lead\/reports\/([^/]+)\/report\.md$/)
  if (leadMatch?.[1]) return `${leadMatch[1]}:lead:report`

  const architectMatch = rel.match(/^\.gatehouse\/architect\/trees\/([^/]+)\/reports\/architect-summary\.md$/)
  if (architectMatch?.[1]) return `${architectMatch[1]}:architect:summary`

  const rootMatch = rel.match(/^\.gatehouse\/architect\/trees\/([^/]+)\/reports\/root-delivery\.md$/)
  if (rootMatch?.[1]) return `${rootMatch[1]}:root:delivery`

  const retroMatch = rel.match(/^\.gatehouse\/architect\/trees\/([^/]+)\/reports\/nodes\/([^/]+)-retro\.md$/)
  if (retroMatch?.[1] && retroMatch[2]) return `${retroMatch[1]}:retro:${retroMatch[2]}`

  const skillMatch = rel.match(/^\.gatehouse\/skills\/by-domain\/([^/]+)\/([^/]+)\/SKILL\.md$/)
  if (skillMatch?.[1] && skillMatch[2]) return `skill:${skillMatch[1]}:${skillMatch[2]}`

  return undefined
}

export function blogMissionIdFromPostId(postId: string) {
  if (postId.startsWith("skill:")) return undefined
  if (postId.endsWith(":lead:report")) {
    const missionId = postId.slice(0, -":lead:report".length)
    return missionId || undefined
  }
  if (postId.endsWith(":architect:summary")) {
    const missionId = postId.slice(0, -":architect:summary".length)
    return missionId || undefined
  }
  if (postId.endsWith(":root:delivery")) {
    const missionId = postId.slice(0, -":root:delivery".length)
    return missionId || undefined
  }
  const retroPrefix = ":retro:"
  const retroAt = postId.indexOf(retroPrefix)
  if (retroAt > 0) return postId.slice(0, retroAt)
  return undefined
}

export function blogPostRelPath(postId: string) {
  if (postId.endsWith(":lead:report")) {
    return leadBlogReportRel(postId.slice(0, -":lead:report".length))
  }
  if (postId.endsWith(":architect:summary")) {
    return architectBlogSummaryRel(postId.slice(0, -":architect:summary".length))
  }
  if (postId.endsWith(":root:delivery")) {
    return rootBlogDeliveryRel(postId.slice(0, -":root:delivery".length))
  }
  const retroPrefix = ":retro:"
  const retroAt = postId.indexOf(retroPrefix)
  if (retroAt > 0) {
    return retroBlogNodeRel(postId.slice(0, retroAt), postId.slice(retroAt + retroPrefix.length))
  }
  if (postId.startsWith("skill:")) {
    const parts = postId.split(":")
    if (parts.length === 3 && parts[1] && parts[2]) return skillBlogRel(parts[1], parts[2])
  }
  return undefined
}

function parsePublishedDocument(text: string): BlogPublishedDocument {
  const raw = parseYaml(text)
  if (!isRecord(raw)) return { schema_version: 1, posts: [] }
  const posts = Array.isArray(raw.posts)
    ? raw.posts.flatMap((entry): BlogPublishedEntry[] => {
        if (!isRecord(entry)) return []
        const id = readString(entry.id)
        const relPath = readString(entry.path)
        const published_at = readString(entry.published_at)
        if (!id || !relPath || !published_at) return []
        return [
          {
            id,
            path: relPath,
            published_at,
            ...(readString(entry.published_by) && { published_by: readString(entry.published_by) }),
          },
        ]
      })
    : []
  return { schema_version: 1, posts }
}

export async function readBlogPublishedDocument(projectDirectory: string) {
  const file = Bun.file(blogPublishedPath(projectDirectory))
  if (!(await file.exists())) return { schema_version: 1, posts: [] } satisfies BlogPublishedDocument
  return parsePublishedDocument(await file.text())
}

export async function readPublishedBlogPostIds(projectDirectory: string) {
  const doc = await readBlogPublishedDocument(projectDirectory)
  return new Set(doc.posts.map((entry) => entry.id))
}

export async function publishBlogPost(
  projectDirectory: string,
  input: { postId: string; reportPath: string; publishedBy?: string },
) {
  const doc = await readBlogPublishedDocument(projectDirectory)
  const published_at = new Date().toISOString()
  const existing = doc.posts.find((entry) => entry.id === input.postId)
  if (existing) {
    existing.path = input.reportPath
    existing.published_at = published_at
    if (input.publishedBy) existing.published_by = input.publishedBy
  } else {
    doc.posts.push({
      id: input.postId,
      path: input.reportPath,
      published_at,
      ...(input.publishedBy && { published_by: input.publishedBy }),
    })
  }
  const target = blogPublishedPath(projectDirectory)
  await Bun.write(target, stringifyYaml(doc))
  void requestPortalBlogCacheRefresh(projectDirectory)
  return { post_id: input.postId, path: input.reportPath, published_at, republished: Boolean(existing) }
}

export type UnpublishBlogPostResult =
  | { ok: true; post_id: string; path: string; unpublished_at: string }
  | { ok: false; code: "NOT_PUBLISHED" | "NO_OWNER" | "NOT_OWNER"; published_by?: string }

export async function unpublishBlogPost(
  projectDirectory: string,
  input: { postId: string; actor: string },
): Promise<UnpublishBlogPostResult> {
  const doc = await readBlogPublishedDocument(projectDirectory)
  const index = doc.posts.findIndex((entry) => entry.id === input.postId)
  if (index < 0) return { ok: false, code: "NOT_PUBLISHED" }
  const entry = doc.posts[index]!
  if (!entry.published_by) return { ok: false, code: "NO_OWNER" }
  if (entry.published_by !== input.actor) {
    return { ok: false, code: "NOT_OWNER", published_by: entry.published_by }
  }
  doc.posts.splice(index, 1)
  await Bun.write(blogPublishedPath(projectDirectory), stringifyYaml(doc))
  void requestPortalBlogCacheRefresh(projectDirectory)
  return {
    ok: true,
    post_id: input.postId,
    path: entry.path,
    unpublished_at: new Date().toISOString(),
  }
}
