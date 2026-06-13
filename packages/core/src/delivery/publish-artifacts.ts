import { existsSync } from "node:fs"
import path from "node:path"
import { gatehouseRoot, resolveProjectPath } from "../paths.ts"
import { runDeliveryPrecheck } from "./criteria.ts"
import { BLOG_PUBLISHER_SYSTEM, publishBlogPost } from "../portal/blog-publish.ts"
import {
  criterionIdForDeliverablePath,
  deliverableBlogPostId,
  deliverablePathsFromCriteria,
  deliverablesReadyToPublish,
  resolveSkillBlogPostId,
} from "./publish-policy.ts"
import type { DoneWhenCriterion, DeliveryPrecheck } from "./types.ts"

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

/** Project deliverable paths eligible for Lead publish on mission_complete(publish_deliverables=true). */
export function pendingMissionPublishPaths(criteria: DoneWhenCriterion[]) {
  return deliverablePathsFromCriteria(criteria)
}

export async function resolveDeliverablesToPublishAtFinalize(input: {
  projectDirectory: string
  criteria: DoneWhenCriterion[]
  forceSubmit: boolean
}) {
  const freshPrecheck = await runDeliveryPrecheck(input.projectDirectory, input.criteria)
  const paths = deliverablesReadyToPublish(
    input.criteria,
    freshPrecheck,
    input.forceSubmit,
  )
  return { paths, freshPrecheck }
}

export function explainPublishSkipped(input: {
  criteria: DoneWhenCriterion[]
  precheck: DeliveryPrecheck[]
  forceSubmit: boolean
  requestedPaths: string[]
  published: string[]
}) {
  const warnings: string[] = []
  const deliverablePaths = deliverablePathsFromCriteria(input.criteria)
  if (deliverablePaths.length === 0) {
    warnings.push(
      "NO_DELIVERABLE_PATHS: done_when has no path_exists deliverables. " +
        "Use YAML `- path: reports/foo.html` or a string like `path: reports/foo.html` / `文件存在: reports/foo.html`.",
    )
    return warnings
  }
  if (input.published.length > 0 && input.published.length >= input.requestedPaths.length) {
    return warnings
  }

  const unpublished = input.requestedPaths.filter((relPath) => !input.published.includes(relPath))
  if (unpublished.length > 0) {
    warnings.push(
      `PUBLISH_SKIPPED: deliverable files missing or empty at publish time: ${unpublished.join(", ")}`,
    )
    return warnings
  }

  const ready = deliverablesReadyToPublish(input.criteria, input.precheck, input.forceSubmit)
  if (ready.length > 0) return warnings

  const missing = deliverablePaths.filter((relPath) => {
    const criterionId = criterionIdForDeliverablePath(input.criteria, relPath)
    const item = input.precheck.find((entry) => entry.criterion_id === criterionId)
    return item?.status === "unmet"
  })
  if (missing.length > 0) {
    warnings.push(`PRECHECK_UNMET: deliverable files missing at publish time: ${missing.join(", ")}`)
    return warnings
  }

  warnings.push(
    "PUBLISH_SKIPPED: deliverable paths were not eligible for publish (precheck did not pass and no force_reason on delivery).",
  )
  return warnings
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
