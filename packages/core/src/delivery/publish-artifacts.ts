import { existsSync } from "node:fs"
import path from "node:path"
import { gatehouseRoot } from "../paths.ts"
import { resolveProjectPath } from "../paths.ts"
import { BLOG_PUBLISHER_SYSTEM, publishBlogPost } from "../portal/blog-publish.ts"
import {
  deliverableBlogPostId,
  deliverablesReadyToPublish,
  publishPathsFromCriteria,
  resolveSkillBlogPostId,
} from "./publish-policy.ts"
import type { DoneWhenCriterion } from "./types.ts"

export async function publishDeliverablePaths(input: {
  projectDirectory: string
  missionId: string
  paths: string[]
  publishedBy?: string
}) {
  const published: string[] = []
  for (const relPath of input.paths) {
    const abs = resolveProjectPath(input.projectDirectory, relPath)
    if (!(await Bun.file(abs).exists())) continue
    if (!(await Bun.file(abs).text()).trim()) continue
    await publishBlogPost(input.projectDirectory, {
      postId: deliverableBlogPostId(input.missionId, relPath),
      reportPath: relPath,
      publishedBy: input.publishedBy ?? BLOG_PUBLISHER_SYSTEM,
    })
    published.push(relPath)
  }
  return published
}

export async function publishMissionDeliverables(input: {
  projectDirectory: string
  missionId: string
  criteria: DoneWhenCriterion[]
  precheck: { criterion_id: number; status: string }[]
  forceSubmit: boolean
  publishedBy?: string
  paths?: string[]
}) {
  const paths =
    input.paths ??
    deliverablesReadyToPublish(input.criteria, input.precheck, input.forceSubmit)
  return publishDeliverablePaths({
    projectDirectory: input.projectDirectory,
    missionId: input.missionId,
    paths,
    ...(input.publishedBy && { publishedBy: input.publishedBy }),
  })
}

/** All publish: paths to release when lead accepts — independent of precheck at submit time. */
export function pendingMissionPublishPaths(criteria: DoneWhenCriterion[]) {
  return publishPathsFromCriteria(criteria)
}

export async function publishAllSkillBlogPosts(projectDirectory: string) {
  const skillsRoot = path.join(gatehouseRoot(projectDirectory), "skills", "by-domain")
  if (!existsSync(skillsRoot)) return []

  const published: string[] = []
  const glob = new Bun.Glob("*/*/SKILL.md")
  for await (const rel of glob.scan({ cwd: skillsRoot })) {
    const relPath = path.posix.join(".gatehouse", "skills", "by-domain", rel.replace(/\\/g, "/"))
    const skillId = resolveSkillBlogPostId(relPath)
    if (!skillId) continue
    const abs = resolveProjectPath(projectDirectory, relPath)
    if (!(await Bun.file(abs).exists())) continue
    if (!(await Bun.file(abs).text()).trim()) continue
    await publishBlogPost(projectDirectory, {
      postId: skillId,
      reportPath: relPath,
      publishedBy: BLOG_PUBLISHER_SYSTEM,
    })
    published.push(relPath)
  }
  return published
}
