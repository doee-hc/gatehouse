import path from "node:path"
import type { DoneWhenCriterion } from "./types.ts"

export function normalizeProjectRelPath(relPath: string) {
  return relPath.replace(/\\/g, "/").replace(/^\.\//, "")
}

/** Gatehouse coordination reports — not Portal deliverables. */
export function isCoordinationReportPath(relPath: string) {
  const rel = normalizeProjectRelPath(relPath)
  if (!rel.startsWith(".gatehouse/")) return false
  if (rel.startsWith(".gatehouse/skills/by-domain/")) return false
  return rel.includes("/reports/")
}

export function isSkillPublishPath(relPath: string) {
  const rel = normalizeProjectRelPath(relPath)
  return /^\.gatehouse\/skills\/by-domain\/[^/]+\/[^/]+\/SKILL\.md$/.test(rel)
}

export function deliverableBlogPostId(missionId: string, relPath: string) {
  const normalized = normalizeProjectRelPath(relPath)
  const slug = normalized
    .replace(/\.gatehouse\//g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `${missionId}:deliverable:${slug || "file"}`
}

export function blogMissionIdFromDeliverablePostId(postId: string) {
  const prefix = ":deliverable:"
  const at = postId.indexOf(prefix)
  if (at <= 0) return undefined
  return postId.slice(0, at) || undefined
}

/** Project deliverable paths from path_exists checks (excludes .gatehouse/ coordination files). */
export function deliverablePathsFromCriteria(criteria: DoneWhenCriterion[]) {
  const paths: string[] = []
  const seen = new Set<string>()
  for (const criterion of criteria) {
    if (criterion.check.kind !== "path_exists") continue
    const normalized = normalizeProjectRelPath(criterion.check.path)
    if (normalized.startsWith(".gatehouse/")) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    paths.push(normalized)
  }
  return paths
}

export function criterionIdForDeliverablePath(criteria: DoneWhenCriterion[], relPath: string) {
  const normalized = normalizeProjectRelPath(relPath)
  return criteria.find(
    (item) =>
      item.check.kind === "path_exists" && normalizeProjectRelPath(item.check.path) === normalized,
  )?.id
}

export function criterionIdForPublishPath(criteria: DoneWhenCriterion[], relPath: string) {
  return criterionIdForDeliverablePath(criteria, relPath)
}

export function isDeliverablePathAllowed(criteria: DoneWhenCriterion[], relPath: string) {
  const normalized = normalizeProjectRelPath(relPath)
  return deliverablePathsFromCriteria(criteria).some((item) => item === normalized)
}

export function isPublishPathAllowed(criteria: DoneWhenCriterion[], relPath: string) {
  return isDeliverablePathAllowed(criteria, relPath)
}

export function resolveSkillBlogPostId(relPath: string) {
  const rel = normalizeProjectRelPath(relPath)
  const skillMatch = rel.match(/^\.gatehouse\/skills\/by-domain\/([^/]+)\/([^/]+)\/SKILL\.md$/)
  if (!skillMatch?.[1] || !skillMatch[2]) return undefined
  return `skill:${skillMatch[1]}:${skillMatch[2]}`
}

export type PublishTarget =
  | { kind: "skill"; postId: string; path: string }
  | { kind: "deliverable"; postId: string; path: string; missionId: string }
  | { kind: "blocked"; path: string; reason: string }

export function resolvePublishTarget(input: {
  missionId: string
  relPath: string
  criteria: DoneWhenCriterion[]
}): PublishTarget {
  const pathNorm = normalizeProjectRelPath(input.relPath)
  if (isCoordinationReportPath(pathNorm)) {
    return {
      kind: "blocked",
      path: pathNorm,
      reason: "Gatehouse coordination reports are not publishable; use project deliverable paths from done_when",
    }
  }
  const skillId = resolveSkillBlogPostId(pathNorm)
  if (skillId) {
    return { kind: "skill", postId: skillId, path: pathNorm }
  }
  if (pathNorm.startsWith(".gatehouse/")) {
    return {
      kind: "blocked",
      path: pathNorm,
      reason: "Only mission deliverable paths (done_when path_exists) or domain SKILL.md may be published",
    }
  }
  if (!isPublishPathAllowed(input.criteria, pathNorm)) {
    return {
      kind: "blocked",
      path: pathNorm,
      reason:
        `Path is not a mission deliverable (done_when path_exists) for mission ${input.missionId}. ` +
        `Lead may publish accepted deliverables via gatehouse_mission_complete(publish_deliverables=true).`,
    }
  }
  return {
    kind: "deliverable",
    postId: deliverableBlogPostId(input.missionId, pathNorm),
    path: pathNorm,
    missionId: input.missionId,
  }
}

/** Deliverable paths whose path_exists precheck is met (or force submit). */
export function deliverablesReadyToPublish(
  criteria: DoneWhenCriterion[],
  precheck: { criterion_id: number; status: string }[],
  forceSubmit: boolean,
) {
  const metIds = new Set(
    precheck.filter((item) => item.status === "met" || item.status === "partial").map((item) => item.criterion_id),
  )
  return deliverablePathsFromCriteria(criteria).filter((publishPath) => {
    const criterionId = criterionIdForDeliverablePath(criteria, publishPath)
    if (criterionId === undefined) return false
    if (forceSubmit) return true
    return metIds.has(criterionId)
  })
}

export function isUnderProjectRoot(projectDirectory: string, relPath: string) {
  const abs = path.resolve(projectDirectory, normalizeProjectRelPath(relPath))
  const root = path.resolve(projectDirectory)
  return abs === root || abs.startsWith(`${root}${path.sep}`)
}
